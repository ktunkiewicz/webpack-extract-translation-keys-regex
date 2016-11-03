/*!
 Copyright 2016 Kamil Tunkiewicz
 based on Dmitriy Kubyshkin work

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

'use strict';

var KeyGenerator = require('./key-generator');
var fs = require('fs');

/**
 * @param {Object<string,string|RegExp>} options
 * @constructor
 */
function ExtractTranslationRegexPlugin(options) {
    options = options || {};
    this.functionPattern = options.functionPattern || /gettext\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)(")|'([^'\\]*(?:\\.[^'\\]*)*)('))/gm;
    this.functionReplace = options.functionReplace || 'gettext($2$4$1$3$2$4';
    this.groupIndex = options.groupIndex || [ 1, 3 ];
    this.done = options.done || function () {};
    this.output = typeof options.output === 'string' ? options.output : false;
    this.mangle = options.mangle || false;
    this.moduleFilter = options.moduleFilter || [ /((?:[^!?\s]+?)(?:\.js|\.jsx|\.ts))$/, /^((?!node_modules).)*$/ ]

    if (options.functionPattern && !options.functionReplace) {
        throw new Error("ExtractTranslationRegexPlugin: If you provide functionPattern, you must provide functionReplace");
    }
    if (typeof this.groupIndex !== 'object') {
        this.groupIndex = [ this.groupIndex ];
    }
}

ExtractTranslationRegexPlugin.prototype.apply = function(compiler) {
    this.keys = Object.create(null);
    this.generator = KeyGenerator.create();

    compiler.plugin('compilation', function(compilation) {

        // plug into the process after all chunks are splitted and optimized, but before minification is done
        compilation.plugin('optimize-chunks', function(chunks, records) {
            for (var chunk_id in chunks) {
                var chunk = chunks[chunk_id];
                for (var module_id in chunk.modules) {
                  var module = chunk.modules[module_id];

                    // work only with modules that match the moduleFilter rules
                    if (module.userRequest && filterModule(module.userRequest, this.moduleFilter)) {
                        var source = module._source._value;
                        var regex = ensureRegExp(this.functionPattern);

                        // iterating keys found in module
                        var match;
                        while ((match = regex.exec(source)) !== null) {
                            var keyIndex = getKeyIndexFromMatch(match, this.groupIndex);
                            if (keyIndex === -1) {
                                compilation.errors.push(
                                    new Error("ExtractTranslationRegexPlugin: The provided `functionPattern` regular expression do not contain capture block. Please check your webpack.config.js file.")
                                );
                                return false;
                            }

                            var original = match[0];
                            var value = match[keyIndex];
                            var key = value;

                            // saving translation key per module
                            if (!this.keys[chunk.name]) { this.keys[chunk.name] = {}; }
                            if (!(value in this.keys[chunk.name])) {
                                if (this.mangle) {
                                    key = this.generator.next().value;
                                }
                                this.keys[chunk.name][value] = key;
                            }

                            // replacing keys in source
                            if (this.mangle) {
                                // build the replacement with new (mangled) key
                                var replacement = this.functionReplace;
                                var tmpMatch = match.slice(0);
                                for (var i = 1; i < tmpMatch.length; i++) {
                                    if (typeof tmpMatch[i] == 'undefined') {
                                        tmpMatch[i] = '';
                                    } else {
                                        // if the match is translation key
                                        if (this.groupIndex.indexOf(i) !== -1) {
                                            if (i == keyIndex) {
                                                tmpMatch[i] = key;
                                            } else {
                                                tmpMatch[i] = '';
                                            }
                                        }
                                    }
                                    replacement = replacement.replace(new RegExp('\\$' + i, 'g'), tmpMatch[i])
                                }
                                source = source.replace(
                                    new RegExp(sanitizeForRegexp(original), 'gm'),
                                    replacement
                                );
                            }
                        }

                        module._source._value = source;
                    }
                }
            }

            // after we are done, this.keys is flipped from value:key to key:value
            for (var chunkName in this.keys) {
                this.keys[chunkName] = flipObject(this.keys[chunkName]);
            }

            return false;
        }.bind(this));
    }.bind(this));

    compiler.plugin('done', function(stats) {
        this.done(this.keys, stats);
        if (this.output) {
            this.output = this.output.replace('[child]', stats.compilation.compiler.name);
            if (!this.output.match(/\[chunk]/)) {

                // single file output mode - merging keys from all chunks together
                var output = {};
                for (var i in this.keys) {
                    output = Object.assign(output, this.keys[i]);
                }
                fs.writeFileSync(this.output, JSON.stringify(output, null, 2));
            } else {

                // multiple files output mode
                for (var chunkName in this.keys) {
                    var safeChunkName = chunkName.replace(/[^a-z0-9.\-_]+/gi, '-');
                    var filename = this.output.replace('[chunk]', safeChunkName);
                    fs.writeFileSync(filename, JSON.stringify(this.keys[chunkName], null, 2));
                }
            }
        }
    }.bind(this));
};

/**
 * Filter module request using regular expression or array of regular expressions.
 * An array of regular expressions is matched one after another and if any of them returns no match, the function
 * returns false. If all of them matched - it returns true.
 * The input for regexp matching is always a last matched group from previous expression. So you can combine regular
 * expressions in a chain.
 *
 * @param {string} moduleRequest
 * @param {Array<RegExp>} moduleFilter
 * @returns {boolean}
 */
var filterModule = function (moduleRequest, moduleFilter) {
    for (var i in moduleFilter) {
        var matches = moduleRequest.match(moduleFilter[i]);
        if (matches === null) {
            return false;
        }
        moduleRequest = matches[matches.length-1];
    }
    return true;
};

/**
 * Ensures that provided rules are regexp with "g" and "m" modifier added.
 * If string provided - builds regexp from it.
 *
 * @param {RegExp|string} regexp
 * @return {RegExp}
 */
var ensureRegExp = function (regexp) {
    if (typeof regexp == 'string') {
        return new RegExp(sanitizeForRegexp(regexp), 'gm')
    } else {
        var flags = regexp.flags;
        if (flags.indexOf('g') === -1) { flags += 'g'; }
        if (flags.indexOf('m') === -1) { flags += 'm'; }
        return new RegExp(regexp.source, flags);
    }
}

/**
 * Sanitizes string to be used in regexp match
 *
 * @param {string} regexpString
 * @returns {string}
 */
var sanitizeForRegexp = function (regexpString) {
    return regexpString.replace(/[\-\[\]\/{}()*+?.\\\^$|]/g, "\\$&");
}

/**
 * Returns an object with values flipped with keys
 *
 * @param Object<string.string> obj
 * @returns Object<string.string>
 */
var flipObject = function (obj) {
    var newObj = {};
    for (var prop in obj) {
        if(obj.hasOwnProperty(prop)) {
            newObj[obj[prop]] = prop;
        }
    }
    return newObj;
};

/**
 * Gets translation key from match according to `groupIndex` data
 * @param {Array} match
 * @param {Array} groupIndex
 * @returns {int}
 */
var getKeyIndexFromMatch = function(match, groupIndex) {
    for (var i in groupIndex) {
        var index = groupIndex[i];
        if (match[index]) {
            return index;
        }
    }
    return -1;
};

module.exports = ExtractTranslationRegexPlugin;
