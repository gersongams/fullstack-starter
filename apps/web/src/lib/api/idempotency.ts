/**
 * Idempotency-Key values for one form. The API runs a request with a given key
 * once and replays its response to retries, so a double submit or a retry
 * after a lost response cannot create a second row.
 *
 * A key names one request, not one form: the API rejects a key that comes back
 * with a different body. So the same body gets the same key again (a retry),
 * and an edited body gets a new one. Create one per mounted form:
 *
 *   const [keyFor] = useState(createIdempotencyKeys);
 *   create.mutate({ body, headers: { "Idempotency-Key": keyFor(body) } });
 */
export function createIdempotencyKeys() {
  let last: { fingerprint: string; key: string } | undefined;

  return function keyFor(body: unknown): string {
    const fingerprint = JSON.stringify(body);
    if (last?.fingerprint !== fingerprint) {
      last = { fingerprint, key: crypto.randomUUID() };
    }
    return last.key;
  };
}
