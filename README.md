# Webpack Extract Translation Keys Plugin (Regex version)

> This plugin was inspired by [webpack-extract-translation-keys](https://github.com/grassator/webpack-extract-translation-keys). It works in a completely different way, but it shares the concept and some of the source code, so I leave the original copyright info in files.  
  
Webpack provides an official plugin for managing translation using [i18n-webpack-plugin](https://github.com/webpack/i18n-webpack-plugin), but in only allows for build-time translations by replacing strings in the source code.

This plugin serves a similar purposes, but instead of replacing translation keys with actual string values it just collects translation keys allowing you to know exactly which translations are necessary for your client side.

Approach like this also allows to provide dynamically generated translation bundles to the client allowing you to get real-time updates to translation without regenerating whole client side bundle.

#### Differences from webpack-extract-translation-keys plugin

This plugin works directly on bundle's source code by searching (and optionally replacing) translation keys using regular expressions.

This approach has some advantages against using the webpack's parser very limited api. It can find the translation key anywhere in the bundle code. This comes with some small drawback, which may limit the use to particular use cases.

Pros:
- It finds translation keys everywhere, not only withing pure function calls. For example, the webpack parser cannot find translation key in this structure:   
```
some_function_call(
  intl.translate("some key)
)
```
- It can extract keys from any structure - this depends only on the regex provided.
- It can extract translation keys per bundle and even per compilation child.
- The key generator has been changed to use only alphanumeric characters. Just in case.

Cons:
- It is quite dumb... It is just smart enough not to search in anything else than js/jsx/ts files, and not inside `node_modules` folder (this behaviour is configurable). 
  
  Althrough it will still find/replace the translation key in anything that looks like a proper translation function. So you have to **choose the function name wisely**.
  
  For example the `translate()` method name is **not** the best choice. The plugin will run through everything in the bundle, including comments, embedded strings, etc. So if your pattern looks for `translate(''`), then things like `jQuery("<div style=\"transform: translate('-50px')\">")` will get matched too.

This version of plugin is particularly useful in large applications (splitting per bundle functionality) that use object oriented approach (for example react-intl). See examples below.

## Usage

### Configuration

First you need to install plugin:

```bash
npm install --save-dev webpack-extract-translation-keys-regex-plugin
```

And then include it in your configuration:

```javascript
// webpack.config.js

var ExtractTranslationKeysPlugin = require('webpack-extract-translation-keys-regex-plugin');
module.exports = {
    plugins: [
        new extractTranslationKeysRegexPlugin({
            // matches first property in intl.formatMessage call
            // matching escaped quotes method from here: http://stackoverflow.com/a/5696141
            functionPattern: /intl\.formatMessage\(\s*{\s*id:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)(")|'([^'\\]*(?:\\.[^'\\]*)*)('))/gm,
            output: path.join(PATHS.build, 'translation-keys.json')
        })
    ]

    // rest of your configuration...
}
```

The above config works fine with `formatMessage` from `react-intl`: https://github.com/yahoo/react-intl/wiki/API#formatmessage 

Now inside your module you can write something like this:

```js
console.log(intl.formatMessage({ id: 'translation-key-1' }));
console.log(intl.formatMessage({ id: 'translation-key-1' }));
```

If you run `webpack` now, you should get `dist/translation-keys.json` file with following content:

```json
{
    "translation-key-1": "translation-key-1",
    "translation-key-2": "translation-key-2"
}
```

It may seems like a waste to output a map with the keys and values being the same thing, the purpose is to keep the output format consistent with the times when the `mangle` option is enabled.

> **WARNING:** the format of the output without mangling has changed from array to a map since version 2.x. If you want to have old behavior, you can implement it using `done` callback option.

### Key Mangling

In some applications translation keys are quite long, so for the situations where you want to save some additional bytes in your application, you can enable mangling during the plugin initialization:

```js
// ...
    plugins: [
        new extractTranslationKeysRegexPlugin({
            functionPattern: /intl\.formatMessage\(\s*{\s*id:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)(")|'([^'\\]*(?:\\.[^'\\]*)*)('))/gm,
            functionReplace: 'intl.formatMessage({id:$2$1$2',
            mangle: true,
            output: path.join(PATHS.build, 'translation-keys.json')
        })
    ]
// ...
```

This setting changes the behavior of the plugin to replace the key name with a minimal ascii-readable string.

In order to be able to map back to the original translation key, the plugin outputs mapping object with keys being mangle keys and the values being the original ones:

```json
{"0": "translation-key-1", "1": "translation-key-2"}
```

> It's recommended to only enable mangling for production builds, as it makes the debugging harder and also may break hot reloading, depending on your setup.

### Options

#### - `functionPattern`

Default value: `/gettext\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)(")|'([^'\\]*(?:\\.[^'\\]*)*)('))/gm`

This should be a regular expression object or simply a string. Plugin will internally enforce "g" and "m" flags on the provided regexp.
 
The expression must have at least one outputting group block. By default the first group block one is considered to be the translation key.
You can change this to be any block by modifying the `groupIndex` option.

#### - `groupIndex`

Default value: 1

Specifies which group block from `functionPattern` contains the translation key. 

#### - `moduleFilter`

Default value:
```
[
  /((?:[^!?\s]+?)(?:\.js|\.jsx|\.ts))$/,
  /^((?!node_modules).)*$/
]
```

This specifies which modules to search in. 

By default this configures the plugin to look for translations only in `.js`, `.jsx` and `.ts` files which are not in `node_module` folder.
 

It works by checking module path.
An array of regular expressions is matched one after another agains the filename, and if any of them returns no match, plugin skips the file.
If all of them matched - translation keys will be extracted from given module.

One thing to note here is that these regular expressions work in "chain" - starting from the full filename path, and then each next regular expression gets the output from the last group from previous regular expression.
So if your `moduleFilter` looks like this:
```
[
  /[a-z]+([0-9]+)\.js$/,
  /12/
]
```

it will work like this:
```
file: foobar.js - not matched
file: foobar11.js - not matched
file: foobar12.css - not matched
file: foobar12.js - mathed
```

To specify what "module path" means: 

When you import/require anything into your code it becomes a "module" in webpack's compiler.
The compiler then expands the requested path (including all the loaders defined in the path). Then this expanded module path is checked by `moduleFilter`.
 
So consider this example:
```
import myComponent from ("./src/components/myComponent")
```

The expanded path will look something like this: 
```
/the/root/folder/src/components/myComponent.jsx
```

But if you use inline loaders the module paths gets more complicated, for example:
```
/the/root/folder/node_modules/css-loader/index.js!/the/root/folder/node_modules/postcss-loader/index.js!/the/root/folder/src/assets/css/some.css
```

That's why the default value for this option is a bit more complicated regular expression than one may expect.

#### - `output`

Default value: `false`

You must provide this option if you want the plugin to save the translation keys info file/files.
 
There are tags that can be included in the name:
 - `[chunk]` - this gets replaced with chunk name
 - `[child]` - this gets replaced with compilation child name
 
Example `output` values:
- `translation-keys.js` - simply put everything into single file
- `translation-keys-[chunk].js` - use this if your webpack config produces multiple chunks and you want to have the output splited into file per chunk (separate file will be created for "common" chunk as well).
- `translation-keys-[child]-[chunk].js` - use this if your webpack is configured for multiple runs ("childs").

If you use multiple children configuration, don't forget to add child name:
```
foobarConfig = {
  name: 'foobarApp', // <----- this wil be value of [child[
  entry: {
    foo: PATHS.root + '/apps/foo.js', <--- "foo" will be value of [chunk]
    bar: PATHS.root + '/apps/bar.js'
  }
};
helloWorldConfig = {
  name: 'helloWorldApp',
  entry: {
    helloWorld: PATHS.root + '/apps/helloWorld.js'
  }
};

(... some common things here ...)

translationConfig = {
  plugins: [
    new extractTranslationKeysRegexPlugin({
      output: path.join(PATHS.build, 'translation-keys-[child]-[chunk].json')
    })
  ]
};

module.exports = [
  merge(commonConfig, foobarConfig, translationConfig),
  merge(commonConfig, helloWorldConfig, translationConfig)
];
```

> #####If you use mangling and multiple child compilation
> Please note that when webpack is configured in such way it actually run's the webpack-extract-translation-keys-regex plugin *twice*.
> So the second go has no idea where the last translation keys generator stopped. Thus the translation keys will start from "0" in both child compilations.  

#### - `mangle` 

Default value: `false`

Enables mangling of translation keys. When enabled the `functionReplace` option is required.

#### - `functionReplace`

Default value: `gettext($2$1$2`

This option specifies the replacement for the `functionPattern` when mangling translation keys. It is required if you use mangling.

You can also use this option to change the function name if you like to.

#### - `done`

Default value: `function (result, stats) {}`

Provided parameters:
- `result` - an array of translation keys grouped per output chunk.
- `stats` - statistics provided from webpack about the build results

You can provide your own function that will be applied after the plugin done his job.
Providing this function does not turn off default plugin `done` function. If you want to disable the default behaviour simply don't provide the `output` configuration parameter.

### Error handling

Plugin throws an error if provided `functionPattern` doesn't have group that matches the translation key. It will also refuse to run if you don't provide `functionReplace` when mangling is turned on.  

### TODO

- add tests
- add handling the "on change" event when in watch mode
- do some more testing...

## License

Copyright 2016 Kamil Tunkiewicz and 2015 Dmitriy Kubyshkin

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
