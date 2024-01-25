import { Level } from 'level';
import { ShareLevel } from '../src/index.js';

export type T = {
    assert: (result: boolean, message?: string) => void;
};

export const test = async (name: string, fn: (t: T) => Promise<void>) => {
    const t = {
        assert: (result: boolean, message?: string) => {
            console.log(`Test: ${name} ${message} : ${result ? 'PASS' : 'FAIL'}`);
            if (!result) throw 'Failed test';
        },
    };
    await fn(t);
    console.log('\n\n--------------------------------------\n\n');
};

export async function printDB(title: string, db: Level<string, any> | ShareLevel<any>) {
    console.log('----------- ' + title + '---------------');
    let tmp = '[';
    for await (const [key, value] of db.iterator()) {
        tmp += ` [${key}, ${value}] `;
    }
    tmp += ']';
    console.log(tmp);
}

export async function getAllDB(db: ShareLevel<any>) {
    const finalValueC: [string, string][] = [];
    for await (const [key, value] of db.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueC.push([key, value]);
    }
    return finalValueC;
}

export function delayPromise(duration: number) {
    return new Promise(function (resolve) {
        setTimeout(function () {
            resolve(null);
        }, duration);
    });
}
