export function getSequence(s?: string) {
    var zero = String.fromCharCode(33);
    if (typeof s == 'undefined') return zero;

    let sArr = s.split('');
    var last = sArr[s.length - 1];

    if (last.charCodeAt(0) == 255) {
        sArr.push(zero);
    } else {
        var n = last.charCodeAt(0);
        var c = String.fromCharCode(n + 1);
        sArr[s.length - 1] = c;
    }
    return sArr.join('');
}
