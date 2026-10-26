import { Model, Relation } from '@nozbe/watermelondb';
import { date, field, immutableRelation, json, text } from '@nozbe/watermelondb/decorators';
import { Associations } from '@nozbe/watermelondb/Model';
import type {
  DiagnosticProtocol,
  DiagnosticStatus,
  ParsedDiagnosticMetrics,
} from '../../../shared/types/domain';
import { TableName } from '../schema';
import type Device from './Device';

const sanitizeMetrics = (raw: unknown): ParsedDiagnosticMetrics => {
  if (typeof raw === 'object' && raw !== null) {
    return raw as ParsedDiagnosticMetrics;
  }
  return {};
};

export default class Diagnostic extends Model {
  static table = TableName.DIAGNOSTICS;

  static associations: Associations = {
    [TableName.DEVICES]: { type: 'belongs_to', key: 'device_id' },
  };

  @field('device_id') deviceId!: string;
  @field('protocol') protocol!: DiagnosticProtocol;
  @text('raw_output') rawOutput!: string;
  @json('parsed_metrics', sanitizeMetrics) parsedMetrics!: ParsedDiagnosticMetrics;
  @field('status') status!: DiagnosticStatus;
  @date('executed_at') executedAt!: Date;

  @immutableRelation(TableName.DEVICES, 'device_id') device!: Relation<Device>;
}
