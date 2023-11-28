export const base64Encode = function encode(uint8array: Uint8Array) {
    var output = [];

    for (var i = 0, length = uint8array.length; i < length; i++) {
        output.push(String.fromCharCode(uint8array[i]));
    }

    return btoa(output.join(''));
};

const asCharCode = function asCharCode(c: string) {
    return c.charCodeAt(0);
};

export const base64Decode = function decode(chars: string) {
    return Uint8Array.from(atob(chars), asCharCode);
};