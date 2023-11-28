import { DataConnection, Peer } from 'peerjs';
import { ShareLevel, AbstractSyncClient, AbstractSyncServer, SyncOptions } from '@kele23/levelshare';
import { EventEmitter } from 'events';

class SyncPeerClient extends AbstractSyncClient {
    private connection: DataConnection;

    constructor(db: ShareLevel<any>, connection: DataConnection) {
        super(db);
        this.connection = connection;
    }

    async sync(options?: SyncOptions): Promise<void> {
        if (this.connection.open) {
            super.sync(options);
        } else {
            this.connection.once('open', () => {
                super.sync(options);
            });
        }
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

export type SyncConnection = {
    connection: DataConnection;
    client: SyncPeerClient;
    server: SyncPeerServer;
};

/**
 * @emits id: The id of the current p2p interface
 */
export class SyncP2PPeerJS extends EventEmitter {
    private peer: Peer;
    private db: ShareLevel<any>;
    private connections: Map<string, SyncConnection>;

    constructor(db: ShareLevel<any>) {
        super();
        this.db = db;
        this.connections = new Map();

        // initialize peer
        this.peer = new Peer();
        this._addPeerListeners();
    }

    async sync(options: PeerSyncOptions) {
        let syncConn = this.connections.get(options.peerId);
        if (!syncConn) {
            const newConn = this.peer.connect(options.peerId);
            syncConn = this._makeConnection(newConn);
        }

        // sync
        syncConn.client.sync(options);
    }

    private _makeConnection(connection: DataConnection): SyncConnection {
        const syncConn: SyncConnection = {
            connection,
            client: new SyncPeerClient(this.db, connection),
            server: new SyncPeerServer(this.db, connection),
        };
        this.connections.set(connection.peer, syncConn);
        connection.addListener('close', () => {
            this.connections.delete(connection.peer);
        });
        return syncConn;
    }

    private _addPeerListeners() {
        this.peer.addListener('open', () => {
            this.emit('id', this.peer.id);
        });
        this.peer.addListener('connection', (connection) => {
            this._makeConnection(connection);
        });
        this.peer.addListener('close', () => {
            this.connections.clear();
        });

        // ????
        this.peer.addListener('disconnected', () => {
            // ???? what I have to do?
        });
        this.peer.addListener('error', () => {
            // ???? what I have to do?
        });
    }
}
