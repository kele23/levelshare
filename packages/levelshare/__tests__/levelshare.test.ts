import { ShareLevel } from '../src/index.js';
import { temporaryDirectory } from 'tempy';
import { TestSyncClient, TestSyncServer, test } from './utils.js';

test('basic sync', async function (t) {
    const clientDB = new ShareLevel(temporaryDirectory());
    const serverDB = new ShareLevel(temporaryDirectory());

    await clientDB.batch().put('A', 'A').put('B', 'B').write();
    await serverDB.batch().put('C', 'C').put('D', 'D').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValue: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValue.push([key, value]);
    }

    const checkValue = [
        ['A', 'A'],
        ['B', 'B'],
        ['C', 'C'],
        ['D', 'D'],
    ];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValue));
});

test('basic sync + del', async function (t) {
    const clientDB = new ShareLevel<string>(temporaryDirectory());
    const serverDB = new ShareLevel<string>(temporaryDirectory());

    await clientDB.batch().put('A', 'A').put('B', 'B').del('B').write();
    await serverDB.batch().put('C', 'C').put('D', 'D').del('C').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValue: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValue.push([key, value]);
    }

    const checkValue = [
        ['A', 'A'],
        ['D', 'D'],
    ];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValue));
});

test('sync with empty db', async function (t) {
    const clientDB = new ShareLevel(temporaryDirectory());
    const serverDB = new ShareLevel(temporaryDirectory());

    await clientDB.batch().put('A', 'A').put('B', 'B').del('B').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValue: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValue.push([key, value]);
    }

    const checkValue = [['A', 'A']];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValue));
});

test('sync empty db', async function (t) {
    const clientDB = new ShareLevel(temporaryDirectory());
    const serverDB = new ShareLevel(temporaryDirectory());

    await serverDB.batch().put('A', 'A').put('B', 'B').del('B').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValue: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValue.push([key, value]);
    }

    const checkValue = [['A', 'A']];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValue));
});

test('sync conflict', async function (t) {
    const clientDB = new ShareLevel(temporaryDirectory());
    const serverDB = new ShareLevel(temporaryDirectory());

    await clientDB.batch().put('A', 'CL-A').write();
    await serverDB.batch().put('A', 'SV-A').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValue: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValue.push([key, value]);
    }

    const checkValue = [['A', 'SV-A']];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValue));
});
