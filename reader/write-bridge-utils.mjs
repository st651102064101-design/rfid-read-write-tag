// FX9600 event payloads can be wrapped in arrays or nested objects by the
// management-event webhook. Keep matching independent of that envelope.
export function readerRecords(value, output = []) {
 if (!value || typeof value !== 'object') return output;
 if (Array.isArray(value)) {
  for (const item of value) readerRecords(item, output);
  return output;
 }
 const data = value.data && typeof value.data === 'object' ? value.data : value;
 if (typeof value.type === 'string' && typeof (data.idHex || value.idHex) === 'string') output.push(value);
 for (const child of Object.values(value)) if (child && typeof child === 'object') readerRecords(child, output);
 return output;
}

export function recordEpc(record) {
 return String(record?.data?.idHex || record?.idHex || '').toUpperCase();
}

export function recordAccessResults(record) {
 const data = record?.data && typeof record.data === 'object' ? record.data : record;
 return data?.accessResults;
}
