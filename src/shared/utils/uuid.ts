/**
 * Generador determinístico de identificadores UUID v4 (RFC 4122)
 * utilizado para garantizar idempotencia transaccional en la cola Outbox (PRD §8.2).
 */
export const generateUuidV4 = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    // eslint-disable-next-line no-bitwise
    const randomNibble = (Math.random() * 16) | 0;
    // eslint-disable-next-line no-bitwise
    const value = char === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
    return value.toString(16);
  });
};
