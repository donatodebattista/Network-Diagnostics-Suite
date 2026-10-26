import { Model, Query } from '@nozbe/watermelondb';
import { children, date, field, readonly, text } from '@nozbe/watermelondb/decorators';
import { Associations } from '@nozbe/watermelondb/Model';
import { TableName } from '../schema';
import type Diagnostic from './Diagnostic';
import type Installation from './Installation';

export default class Device extends Model {
  static table = TableName.DEVICES;

  static associations: Associations = {
    [TableName.DIAGNOSTICS]: { type: 'has_many', foreignKey: 'device_id' },
    [TableName.INSTALLATIONS]: { type: 'has_many', foreignKey: 'device_id' },
  };

  @text('ip_address') ipAddress: string;
  @text('mac_address') macAddress: string;
  @text('hostname') hostname: string | null;
  @text('vendor') vendor: string | null;
  @field('serial_number') serialNumber: string | null;
  @readonly @date('created_at') createdAt: Date;
  @readonly @date('updated_at') updatedAt: Date;

  @children(TableName.DIAGNOSTICS) diagnostics: Query<Diagnostic>;
  @children(TableName.INSTALLATIONS) installations: Query<Installation>;
}
