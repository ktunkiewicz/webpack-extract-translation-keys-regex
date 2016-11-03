'use strict';

const alphabet = [];

for (var i = 48; i <= 122; ++i) {
    // Only allow alphanumeric characters
    if (!(i >= 58 && i <= 64) && !(i >= 91 && i <= 96)) {
        alphabet.push(String.fromCharCode(i));
    }
}

exports.create = function *() {
    var index = 0;
    while (true) { // eslint-disable-line
        var remainder = index++;
        var key = '';
        do {
            key = alphabet[remainder % alphabet.length] + key;
            remainder = (remainder / alphabet.length) | 0;
        } while (remainder);
        yield key;
    }
};

