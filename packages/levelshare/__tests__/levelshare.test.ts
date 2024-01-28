import { Level } from 'level';
import { temporaryDirectory } from 'tempy';
import { ShareLevel, SyncRequest, SyncResponse } from '../src/index.js';
import { delayPromise, getAllDB, printDB, test } from './utils.js';
import { SyncServer } from '../src/sync/server.js';
import { SyncClient } from '../src/sync/client.js';

try {
    await test('basic sync', async function (t) {
        const clientDB = new ShareLevel({ location: temporaryDirectory() });
        const serverDB = new ShareLevel({ location: temporaryDirectory() });

        await clientDB.batch().put('A', 'A').put('B', 'B').write();
        await serverDB.batch().put('C', 'C').put('D', 'D').write();

        const server = new SyncServer(serverDB);
        const client = new SyncClient(clientDB);
        client.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                clientDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

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

    await test('basic sync - events', async function (t) {
        const clientDB = new ShareLevel({ location: temporaryDirectory() });
        const serverDB = new ShareLevel({ location: temporaryDirectory() });

        await clientDB.batch().put('A', 'A').put('B', 'B').write();
        await serverDB.batch().put('C', 'C').put('D', 'D').write();

        const server = new SyncServer(serverDB);
        const client = new SyncClient(clientDB);
        client.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                clientDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

        server.db.on("db:sync", () => {
            
        })

        await client.sync();

        

        const checkValue = [
            ['A', 'A'],
            ['B', 'B'],
            ['C', 'C'],
            ['D', 'D'],
        ];
        t.assert(JSON.stringify(checkValue) == JSON.stringify(await getAllDB(clientDB)), 'client');
        t.assert(JSON.stringify(checkValue) == JSON.stringify(await getAllDB(serverDB)), 'server');
        t.assert(JSON.stringify(checkValue) == JSON.stringify(await getAllDB(serverDB)), 'event');
    });

    await test('basic sync - external sublevel', async function (t) {
        const clientExtLevel = new Level(temporaryDirectory(), { keyEncoding: 'utf8' });
        const sublevel = clientExtLevel.sublevel('client') as unknown as Level<string, any>;
        const clientDB = new ShareLevel({ level: sublevel });

        const serverExtLevel = new Level(temporaryDirectory(), { keyEncoding: 'utf8' });
        const serverSublevel = serverExtLevel.sublevel('server') as unknown as Level<string, any>;
        const serverDB = new ShareLevel({ level: serverSublevel });

        await clientDB.batch().put('A', 'A').put('B', 'B').write();
        await serverDB.batch().put('C', 'C').put('D', 'D').write();

        const server = new SyncServer(serverDB);
        const client = new SyncClient(clientDB);
        client.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                clientDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

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

        const server = new SyncServer(serverDB);
        const client = new SyncClient(clientDB);
        client.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                clientDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

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

        const server = new SyncServer(serverDB);
        const client = new SyncClient(clientDB);
        client.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                clientDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

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

        const server = new SyncServer(serverDB);
        const client = new SyncClient(clientDB);
        client.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                clientDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

        await client.sync();

        const checkValue = [['A', 'A']];
        t.assert(JSON.stringify(checkValue) == JSON.stringify(await getAllDB(clientDB)), 'client');
        t.assert(JSON.stringify(checkValue) == JSON.stringify(await getAllDB(serverDB)), 'server');
    });

    await test('sync conflict', async function (t) {
        const clientDB = new ShareLevel({ location: temporaryDirectory() });
        const serverDB = new ShareLevel({ location: temporaryDirectory() });

        await clientDB.batch().put('A', 'CL-A').write();
        await serverDB.batch().put('A', 'SV-A').write();

        const server = new SyncServer(serverDB);
        const client = new SyncClient(clientDB);
        client.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                clientDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

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

    await test('sync conflict x 3 - no concurrency', async function (t) {
        const aDB = new ShareLevel({ location: temporaryDirectory() });
        const bDB = new ShareLevel({ location: temporaryDirectory() });
        const cDB = new ShareLevel({ location: temporaryDirectory() });

        await aDB.batch().put('A', '1').put('X', 'A1').put('X', 'A2').write();
        await bDB.batch().put('B', '2').put('X', 'B1').put('X', 'B2').put('X', 'B3').write();
        await cDB.batch().put('C', '3').put('S', '0').write();

        const server = new SyncServer(cDB);
        const clientA = new SyncClient(aDB);
        clientA.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                aDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });
        const clientB = new SyncClient(bDB);
        clientB.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                bDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

        await clientA.sync();
        await clientB.sync();
        await clientA.sync();

        // server
        const Value = [
            ['A', '1'],
            ['B', '2'],
            ['C', '3'],
            ['S', '0'],
            ['X', 'A2'],
        ];
        t.assert(JSON.stringify(Value) == JSON.stringify(await getAllDB(aDB)), 'A OK');
        t.assert(JSON.stringify(Value) == JSON.stringify(await getAllDB(bDB)), 'B OK');
        t.assert(JSON.stringify(Value) == JSON.stringify(await getAllDB(cDB)), 'C OK');
    });

    await test('sync conflict x 3 - with concurrency', async function (t) {
        const aDB = new ShareLevel({ location: temporaryDirectory(), id: 'A' });
        const bDB = new ShareLevel({ location: temporaryDirectory(), id: 'B' });
        const cDB = new ShareLevel({ location: temporaryDirectory(), id: 'C' });

        await aDB.batch().put('A', '1').put('X', 'A1').put('X', 'A2').write();
        await bDB.batch().put('B', '2').put('X', 'B1').put('X', 'B2').put('X', 'B3').write();
        await cDB.batch().put('C', '3').put('S', '0').write();

        const server = new SyncServer(cDB);
        const clientA = new SyncClient(aDB);
        clientA.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                aDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });
        const clientB = new SyncClient(bDB);
        clientB.setTransporter((data: SyncRequest): Promise<SyncResponse> => {
            return new Promise((resolve) => {
                bDB.nextTick(async () => {
                    resolve(await server.receive(data));
                });
            });
        });

        const aPromise = async () => {
            await delayPromise(1);
            try {
                await clientA.sync();
            } catch (e) {}
            await delayPromise(1000);
            await clientA.sync();
            console.log('A promise');
        };

        const bPromise = async () => {
            await clientB.sync();
            await delayPromise(3000);
            await clientB.sync();
            console.log('B promise');
        };

        await Promise.all([aPromise(), bPromise()]);

        await printDB('A', aDB.realdb);
        await printDB('B', bDB.realdb);
        await printDB('C', cDB.realdb);

        // server
        const Value = [
            ['A', '1'],
            ['B', '2'],
            ['C', '3'],
            ['S', '0'],
            ['X', 'B3'],
        ];
        t.assert(JSON.stringify(Value) == JSON.stringify(await getAllDB(aDB)), 'A OK');
        t.assert(JSON.stringify(Value) == JSON.stringify(await getAllDB(bDB)), 'B OK');
        t.assert(JSON.stringify(Value) == JSON.stringify(await getAllDB(cDB)), 'C OK');
    });
} catch (e) {
    console.error('EXIT - test failed');
}
