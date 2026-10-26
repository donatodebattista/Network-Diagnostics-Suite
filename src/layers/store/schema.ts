import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const SCHEMA_VERSION = 1;

export enum TableName {
  DEVICES = 'devices',
  DIAGNOSTICS = 'diagnostics',
  INSTALLATIONS = 'installations',
  OUTBOX_QUEUE = 'outbox_queue',
}

export const databaseSchema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    tableSchema({
      name: TableName.DEVICES,
      columns: [
        { name: 'ip_address', type: 'string', isIndexed: true },
        { name: 'mac_address', type: 'string', isIndexed: true },
        { name: 'hostname', type: 'string', isOptional: true },
        { name: 'vendor', type: 'string', isOptional: true },
        { name: 'serial_number', type: 'string', isOptional: true, isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: TableName.DIAGNOSTICS,
      columns: [
        { name: 'device_id', type: 'string', isIndexed: true },
        { name: 'protocol', type: 'string' },
        { name: 'raw_output', type: 'string' },
        { name: 'parsed_metrics', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'executed_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: TableName.INSTALLATIONS,
      columns: [
        { name: 'device_id', type: 'string', isIndexed: true },
        { name: 'technician_notes', type: 'string' },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'photo_uri', type: 'string' },
        { name: 'pdf_path', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: TableName.OUTBOX_QUEUE,
      columns: [
        { name: 'entity_type', type: 'string', isIndexed: true },
        { name: 'entity_id', type: 'string', isIndexed: true },
        { name: 'endpoint', type: 'string' },
        { name: 'payload', type: 'string' },
        { name: 'attempts', type: 'number' },
        { name: 'max_attempts', type: 'number' },
        { name: 'next_retry_at', type: 'number', isOptional: true },
        { name: 'last_error', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
