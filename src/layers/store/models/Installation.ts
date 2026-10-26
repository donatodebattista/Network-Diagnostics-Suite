import { Model, Relation } from '@nozbe/watermelondb';
import { date, field, immutableRelation, readonly, text } from '@nozbe/watermelondb/decorators';
import { Associations } from '@nozbe/watermelondb/Model';
import { TableName } from '../schema';
import type Device from './Device';

export default class Installation extends Model {
  static table = TableName.INSTALLATIONS;

  static associations: Associations = {
    [TableName.DEVICES]: { type: 'belongs_to', key: 'device_id' },
  };

  @field('device_id') deviceId!: string;
  @text('technician_notes') technicianNotes!: string;
  @field('latitude') latitude!: number;
  @field('longitude') longitude!: number;
  @field('photo_uri') photoUri!: string;
  @field('pdf_path') pdfPath!: string | null;
  @readonly @date('created_at') createdAt!: Date;

  @immutableRelation(TableName.DEVICES, 'device_id') device!: Relation<Device>;
}
