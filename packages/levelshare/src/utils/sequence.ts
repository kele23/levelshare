export function nextSequence(s?: string) {
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

export function compareSequence(first?: string, second?: string) {
    let firstF = first || String.fromCharCode(33);
    let secondF = second || String.fromCharCode(33);
    let firstArr = firstF.split('');
    let secondArr = secondF.split('');

    let lghDiff = firstArr.length - secondArr.length;
    if (lghDiff != 0) return lghDiff;

    for (let i = 0; i < firstArr.length; i++) {
        const firstItem = firstArr[i].charCodeAt(0);
        const secondItem = secondArr[i].charCodeAt(0);
        let res = firstItem - secondItem;
        if (res != 0) return res;
    }

    return 0;
}
