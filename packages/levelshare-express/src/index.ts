import { default as core, default as express } from 'express';
import { ShareLevel, AbstractSyncServer } from '@kele23/levelshare';

export class SyncServerExpress extends AbstractSyncServer {
    constructor(db: ShareLevel<any>) {
        super(db);
    }

    handle(app: core.Express, path: string) {
        app.post(
            path,
            express.raw({
                inflate: true,
                limit: '50mb',
                type: 'application/octet-stream',
            }),
            async (req, res) => {
                try {
                    const result = await this.receive(req.body);
                    res.status(200).type('application/octet-stream').end(result, 'binary');
                } catch (e) {
                    console.warn(e);
                    res.status(500).send('error');
                }
            },
        );
    }
}
