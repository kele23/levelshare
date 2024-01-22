import { ShareLevel } from '../src/index.js';
import { temporaryDirectory } from 'tempy';
import { TestSyncClient, TestSyncServer, delayPromise, test } from './utils.js';

await test('basic sync', async function (t) {
    const clientDB = new ShareLevel({ location: temporaryDirectory() });
    const serverDB = new ShareLevel({ location: temporaryDirectory() });

    await clientDB.batch().put('A', 'A').put('B', 'B').write();
    await serverDB.batch().put('C', 'C').put('D', 'D').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();

    // client
    const finalValueC: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueC.push([key, value]);
    }

    // server
    const finalValueS: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueS.push([key, value]);
    }

    const checkValue = [
        ['A', 'A'],
        ['B', 'B'],
        ['C', 'C'],
        ['D', 'D'],
    ];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueC), 'client');
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueS), 'server');
});

await test('basic sync + del', async function (t) {
    const clientDB = new ShareLevel<string>({ location: temporaryDirectory() });
    const serverDB = new ShareLevel<string>({ location: temporaryDirectory() });

    await clientDB.batch().put('A', 'A').put('B', 'B').del('B').write();
    await serverDB.batch().put('C', 'C').put('D', 'D').del('C').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();

    const finalValueC: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValueC.push([key, value]);
    }

    // server
    const finalValueS: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueS.push([key, value]);
    }

    const checkValue = [
        ['A', 'A'],
        ['D', 'D'],
    ];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueC), 'client');
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueS), 'server');
});

await test('sync with empty db', async function (t) {
    const clientDB = new ShareLevel({ location: temporaryDirectory() });
    const serverDB = new ShareLevel({ location: temporaryDirectory() });

    await clientDB.batch().put('A', 'A').put('B', 'B').del('B').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValueC: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValueC.push([key, value]);
    }

    // server
    const finalValueS: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueS.push([key, value]);
    }

    const checkValue = [['A', 'A']];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueC), 'client');
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueS), 'server');
});

await test('sync empty db', async function (t) {
    const clientDB = new ShareLevel({ location: temporaryDirectory() });
    const serverDB = new ShareLevel({ location: temporaryDirectory() });

    await serverDB.batch().put('A', 'A').put('B', 'B').del('B').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValueC: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValueC.push([key, value]);
    }

    // server
    const finalValueS: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueS.push([key, value]);
    }

    const checkValue = [['A', 'A']];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueC), 'client');
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueS), 'server');
});

await test('sync conflict', async function (t) {
    const clientDB = new ShareLevel({ location: temporaryDirectory() });
    const serverDB = new ShareLevel({ location: temporaryDirectory() });

    await clientDB.batch().put('A', 'CL-A').write();
    await serverDB.batch().put('A', 'SV-A').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync();
    const finalValueC: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValueC.push([key, value]);
    }

    // server
    const finalValueS: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueS.push([key, value]);
    }

    const checkValue = [['A', 'SV-A']];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueC), 'client');
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueS), 'server');
});

await test('sync on change', async function (t) {
    const clientDB = new ShareLevel({ location: temporaryDirectory() });
    const serverDB = new ShareLevel({ location: temporaryDirectory() });

    await clientDB.batch().put('A', 'CL-A').write();
    await serverDB.batch().put('A', 'SV-A').write();

    const server = new TestSyncServer(serverDB);
    const client = new TestSyncClient(clientDB, server);

    await client.sync({ continuous: true, type: 'change' });
    

    console.log('Wait 1 seconds...');
    await delayPromise(1000);
    console.log('Write data [B,CL-B]');
    await clientDB.batch().put('B', 'CL-B').write();
    console.log('Wait 5 seconds...');
    await delayPromise(5000);

    const finalValueC: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator()) {
        finalValueC.push([key, value]);
    }

    // server
    const finalValueS: [string, string][] = [];
    for await (const [key, value] of clientDB.iterator<string>({ valueEncoding: 'utf8' })) {
        finalValueS.push([key, value]);
    }

    const checkValue = [
        ['A', 'SV-A'],
        ['B', 'CL-B'],
    ];
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueC), 'client');
    t.assert(JSON.stringify(checkValue) == JSON.stringify(finalValueS), 'server');
});
