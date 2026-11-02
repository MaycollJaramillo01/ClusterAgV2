import { db } from './knex.js';

const MIGRATION_LOCK_ID = 1_248_711_903;
const MIGRATION_LOCK_TIMEOUT_MS = 5_000;
const MIGRATION_IDLE_TRANSACTION_TIMEOUT_MS = 10_000;

const withMigrationLock = async (callback) => {
    if (db.client.config.client !== 'pg') return callback(db);

    // Los candados de sesion (pg_advisory_lock) pueden sobrevivir a una
    // invocacion serverless cuando PgBouncer conserva la conexion del backend.
    // El candado transaccional se libera por PostgreSQL al cerrar la transaccion,
    // incluso si Vercel interrumpe la funcion. Los limites evitan volver a caer
    // en FUNCTION_INVOCATION_TIMEOUT si otra instancia esta migrando.
    return db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT_MS}ms'`);
        await trx.raw(
            `SET LOCAL idle_in_transaction_session_timeout = '${MIGRATION_IDLE_TRANSACTION_TIMEOUT_MS}ms'`
        );
        await trx.raw('SELECT pg_advisory_xact_lock(?)', [MIGRATION_LOCK_ID]);
        return callback(trx);
    });
};

const ensureSchemaMigrationsTable = async (database) => {
    if (await database.schema.hasTable('schema_migrations')) return;
    await database.schema.createTable('schema_migrations', (table) => {
        table.string('version', 120).primary();
        table.string('applied_at', 40).notNullable();
    });
};

const markMigration = async (database, version) => {
    await database('schema_migrations')
        .insert({
            version,
            applied_at: new Date().toISOString()
        })
        .onConflict('version')
        .ignore();
};

const runMigration = async (database, version, migration) => {
    const applied = await database('schema_migrations').where({ version }).first();
    if (applied) return;
    const completed = await migration();
    if (completed === false) return;
    await markMigration(database, version);
};

const ensureAppRecordsTable = async (database) => {
    const exists = await database.schema.hasTable('app_records');
    if (!exists) {
        await database.schema.createTable('app_records', (table) => {
            table.increments('id').primary();
            table.string('collection_name', 120).notNullable();
            table.string('record_id', 120).notNullable();
            table.text('payload_json').notNullable();
            table.string('created_at', 40).notNullable();
            table.string('updated_at', 40).notNullable();
            table.string('email_index', 255).nullable();
            table.string('role_index', 80).nullable();
            table.boolean('is_active_index').nullable();
            table.string('auth_uid_index', 255).nullable();
            table.string('management_key_index', 255).nullable();
            table.string('date_index', 20).nullable();
            table.string('status_index', 80).nullable();
            table.unique(['collection_name', 'record_id']);
            table.index(['collection_name', 'updated_at']);
            table.index(['collection_name', 'email_index']);
            table.index(['collection_name', 'role_index']);
            table.index(['collection_name', 'auth_uid_index']);
            table.index(['collection_name', 'date_index']);
            table.index(['collection_name', 'status_index']);
        });
        return;
    }

    const addColumn = async (name, build) => {
        if (await database.schema.hasColumn('app_records', name)) return;
        await database.schema.table('app_records', build);
    };

    await addColumn('date_index', (table) => table.string('date_index', 20).nullable());
    await addColumn('status_index', (table) => table.string('status_index', 80).nullable());
};

const ensureRecordChangesTable = async (database) => {
    if (await database.schema.hasTable('record_changes')) return;

    await database.schema.createTable('record_changes', (table) => {
        table.bigIncrements('id').primary();
        table.string('collection_name', 120).notNullable();
        table.string('record_id', 120).notNullable();
        table.string('action', 20).notNullable();
        table.string('changed_at', 40).notNullable();
        table.index(['collection_name', 'id']);
    });
};

const ensureAuthSessionsTable = async (database) => {
    const exists = await database.schema.hasTable('auth_sessions');
    if (exists) return;

    await database.schema.createTable('auth_sessions', (table) => {
        table.string('session_id', 140).primary();
        table.string('user_record_id', 120).notNullable();
        table.string('provider', 120).notNullable().defaultTo('password');
        table.string('expires_at', 40).notNullable();
        table.string('last_seen_at', 40).notNullable();
        table.string('created_at', 40).notNullable();
        table.string('ip_address', 120).nullable();
        table.text('user_agent').nullable();
        table.index(['user_record_id']);
        table.index(['expires_at']);
    });
};

const ensureInternalActivityTables = async (database) => {
    if (!await database.schema.hasTable('user_notifications')) {
        await database.schema.createTable('user_notifications', (table) => {
            table.string('id', 120).primary();
            table.string('recipient_id', 120).notNullable();
            table.string('actor_id', 120).notNullable();
            table.string('actor_name', 180).notNullable();
            table.string('type', 40).notNullable();
            table.string('title', 180).notNullable();
            table.text('body').notNullable();
            table.string('entity_type', 40).nullable();
            table.string('entity_id', 120).nullable();
            table.string('entity_collection', 120).nullable();
            table.string('created_at', 40).notNullable();
            table.string('read_at', 40).nullable();
            table.index(['recipient_id', 'created_at']);
            table.index(['recipient_id', 'read_at']);
        });
    }

    if (!await database.schema.hasTable('task_activity_events')) {
        await database.schema.createTable('task_activity_events', (table) => {
            table.string('id', 120).primary();
            table.string('collection_name', 120).notNullable();
            table.string('task_id', 120).notNullable();
            table.string('task_title', 180).notNullable();
            table.string('action', 30).notNullable();
            table.text('fields_json').notNullable();
            table.string('actor_id', 120).notNullable();
            table.string('actor_name', 180).notNullable();
            table.string('created_at', 40).notNullable();
            table.index(['actor_id', 'created_at']);
            table.index(['collection_name', 'task_id', 'created_at']);
        });
    }

    if (!await database.schema.hasTable('attachment_blobs')) {
        await database.schema.createTable('attachment_blobs', (table) => {
            table.string('key', 500).primary();
            table.string('collection_name', 120).notNullable();
            table.string('parent_id', 120).notNullable();
            table.string('attachment_id', 120).notNullable();
            table.string('file_name', 180).notNullable();
            table.string('content_type', 160).notNullable();
            table.binary('file_data').notNullable();
            table.bigInteger('file_size').notNullable();
            table.string('uploaded_by', 120).notNullable();
            table.string('created_at', 40).notNullable();
            table.index(['collection_name', 'parent_id']);
        });
    }

    if (!await database.schema.hasTable('attachment_upload_chunks')) {
        await database.schema.createTable('attachment_upload_chunks', (table) => {
            table.string('object_key', 500).notNullable();
            table.integer('part_index').notNullable();
            table.integer('total_parts').notNullable();
            table.binary('chunk_data').notNullable();
            table.string('uploaded_by', 120).notNullable();
            table.string('created_at', 40).notNullable();
            table.primary(['object_key', 'part_index']);
            table.index(['created_at']);
        });
    }

    if (!await database.schema.hasTable('attachment_upload_sessions')) {
        await database.schema.createTable('attachment_upload_sessions', (table) => {
            table.string('object_key', 500).primary();
            table.string('collection_name', 120).notNullable();
            table.string('parent_id', 120).notNullable();
            table.string('attachment_id', 120).notNullable();
            table.string('file_name', 180).notNullable();
            table.string('content_type', 160).notNullable();
            table.bigInteger('expected_size').notNullable();
            table.integer('total_parts').notNullable();
            table.string('uploaded_by', 120).notNullable();
            table.string('created_at', 40).notNullable();
            table.index(['created_at']);
        });
    }
};

const ensurePolicyAcceptanceTable = async (database) => {
    if (await database.schema.hasTable('policy_acceptances')) return;
    await database.schema.createTable('policy_acceptances', (table) => {
        table.string('policy_key', 100).notNullable();
        table.string('policy_version', 40).notNullable();
        table.string('user_id', 120).notNullable();
        table.string('user_name', 180).notNullable();
        table.string('user_email', 255).notNullable();
        table.string('user_role', 80).notNullable();
        table.string('decision', 20).notNullable();
        table.string('responded_at', 40).notNullable();
        table.primary(['policy_key', 'policy_version', 'user_id']);
        table.index(['policy_key', 'policy_version', 'decision']);
        table.index(['user_id', 'policy_key', 'policy_version']);
    });
};

const ensureOauthStatesTable = async (database) => {
    const exists = await database.schema.hasTable('auth_oauth_states');
    if (!exists) {
        await database.schema.createTable('auth_oauth_states', (table) => {
            table.string('state', 140).primary();
            table.boolean('popup').notNullable().defaultTo(false);
            table.text('redirect_after').nullable();
            table.text('result_token').nullable();
            table.string('expires_at', 40).notNullable();
            table.string('created_at', 40).notNullable();
        });
        return;
    }

    if (!await database.schema.hasColumn('auth_oauth_states', 'result_token')) {
        await database.schema.table('auth_oauth_states', (table) => {
            table.text('result_token').nullable();
        });
    }
};

const ensureIdentityUniqueIndexes = async (database) => {
    const duplicateEmail = await database('app_records')
        .select('email_index')
        .where({ collection_name: 'users' })
        .whereNotNull('email_index')
        .groupBy('email_index')
        .havingRaw('COUNT(*) > 1')
        .first();
    const duplicateAuthUid = await database('app_records')
        .select('auth_uid_index')
        .where({ collection_name: 'users' })
        .whereNotNull('auth_uid_index')
        .whereNot('auth_uid_index', '')
        .groupBy('auth_uid_index')
        .havingRaw('COUNT(*) > 1')
        .first();
    if (duplicateEmail || duplicateAuthUid) {
        console.warn('No se crearon indices unicos de usuarios: primero deben resolverse identidades duplicadas.');
        return false;
    }

    const client = database.client.config.client;
    if (client === 'pg') {
        await database.raw(`
            CREATE UNIQUE INDEX IF NOT EXISTS app_records_users_email_unique
            ON app_records (email_index)
            WHERE collection_name = 'users' AND email_index IS NOT NULL
        `);
        await database.raw(`
            CREATE UNIQUE INDEX IF NOT EXISTS app_records_users_auth_uid_unique
            ON app_records (auth_uid_index)
            WHERE collection_name = 'users' AND auth_uid_index IS NOT NULL AND auth_uid_index <> ''
        `);
        return true;
    }
    if (client === 'sqlite3') {
        await database.raw(`
            CREATE UNIQUE INDEX IF NOT EXISTS app_records_users_email_unique
            ON app_records (email_index)
            WHERE collection_name = 'users' AND email_index IS NOT NULL
        `);
        await database.raw(`
            CREATE UNIQUE INDEX IF NOT EXISTS app_records_users_auth_uid_unique
            ON app_records (auth_uid_index)
            WHERE collection_name = 'users' AND auth_uid_index IS NOT NULL AND auth_uid_index <> ''
        `);
        return true;
    }
    return false;
};

export const migrateDatabase = async () => {
    await withMigrationLock(async (database) => {
        await ensureSchemaMigrationsTable(database);
        await runMigration(database, '001_app_records', () => ensureAppRecordsTable(database));
        await runMigration(database, '002_record_changes', () => ensureRecordChangesTable(database));
        await runMigration(database, '003_auth_sessions', () => ensureAuthSessionsTable(database));
        await runMigration(database, '004_oauth_result_token', () => ensureOauthStatesTable(database));
        await runMigration(database, '005_unique_user_identity', () => ensureIdentityUniqueIndexes(database));
        await runMigration(database, '006_internal_activity_and_attachments', () => ensureInternalActivityTables(database));
        await runMigration(database, '007_policy_acceptances', () => ensurePolicyAcceptanceTable(database));
    });
};
