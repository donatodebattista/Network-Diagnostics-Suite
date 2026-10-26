import Device from './Device';
import Diagnostic from './Diagnostic';
import Installation from './Installation';
import OutboxQueueItem from './OutboxQueueItem';

export { Device, Diagnostic, Installation, OutboxQueueItem };

export const modelClasses = [Device, Diagnostic, Installation, OutboxQueueItem];
