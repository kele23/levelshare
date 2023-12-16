import { DataConnection, Peer } from 'peerjs';
import { ShareLevel, AbstractSyncClient, AbstractSyncServer, SyncOptions, logger } from '@kele23/levelshare';
import { EventEmitter } from 'events';

class SyncPeerClient extends AbstractSyncClient {
    private connection: DataConnection;

    constructor(db: ShareLevel<any>, connection: DataConnection) {
        super(db);
        this.connection = connection;
    }

    protected async send(data: Uint8Array): Promise<Uint8Array> {
        const response = new Promise<Uint8Array>((resolve) => {
            this.connection.once('data', (data) => {
                resolve(data as Uint8Array);
            });
        });

        await this.connection.send(data);
        return await response;
    }
}

class SyncPeerServer extends AbstractSyncServer {
    private connection: DataConnection;

    constructor(db: ShareLevel<any>, connection: DataConnection) {
        super(db);
        this.connection = connection;

        this.connection.addListener('data', async (data) => {
            const response = await this.receive(data as Uint8Array);
            this.connection.send(response);
        });
    }
}

export type PeerSyncOptions = SyncOptions & {
    peerId: string;
};

/**
 * @emits id: The id of the current p2p interface
 */
export class SyncP2PPeerJS extends EventEmitter {
    private peer: Peer;
    private db: ShareLevel<any>;
    private connections: Set<string>;

    constructor(db: ShareLevel<any>, peer?: Peer) {
        super();
        this.db = db;
        this.connections = new Set();

        // initialize peer
        if (peer) this.peer = peer;
        else this.peer = new Peer();
        this.peer = new Peer();
        this._init();
    }

    async sync(options: PeerSyncOptions) {
        if (!this.peer.open) throw 'Peer not opened';
        if (this.connections.has(options.peerId)) throw 'Connection to this peer already running';

        try {
            this.connections.add(options.peerId);
            const connection = this.peer.connect(options.peerId);
            await new Promise<void>((resolve, reject) => {
                connection.once('open', () => {
                    resolve();
                });
                connection.once('error', () => {
                    reject();
                });
            });

            const client = new SyncPeerClient(this.db, connection);
            await client.sync();
            connection.close();
        } finally {
            this.connections.delete(options.peerId);
        }
    }

    private _init() {
        this.peer.on('open', () => {
            logger.log(this.peer.id);
            this.emit('id', this.peer.id);
        });
        this.peer.addListener('connection', (connection) => {
            this.connections.add(connection.peer);
            const server = new SyncPeerServer(this.db, connection);
            connection.on('close', () => {
                this.connections.delete(connection.peer);
            });
        });
    }
}
