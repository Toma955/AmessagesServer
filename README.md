# AmessagesServer

Node.js server za sobe preko **WebSocket** + **libsodium crypto_box**, s **SQLite** snimkom sesija. Ovaj README opisuje kako klijenti (preglednik, mobilna aplikacija, alati) povezuju **HTTP** i **WebSocket** API kako bi implementirali isti protokol.

**Pokretanje:** `npm install` → `npm start` (ili `npm run dev`). **Testovi:** `npm test`.

---

## 1. Konfiguracija servera

| Varijabla | Značenje |
|-----------|----------|
| `PORT` | HTTP + WebSocket na istom portu (zadano `3000`) |
| `DATABASE_PATH` | Put do SQLite datoteke ili `:memory:` za testove |
| `SYNC_DB_INTERVAL_MS` | Periodički sync RAM → SQLite (ms); `0` = isključeno |
| `NODE_ENV` | U `test` načinu isključen je periodički sync i signal handleri za shutdown |
| `ADMIN_TOKEN` | Ako je postavljen, admin API (dnevnik sobe, prekid strane, SSE) zahtijeva `Authorization: Bearer …`, zaglavlje `X-Admin-Token` ili query `admin_token` na SSE URL-u |

WebSocket URL: `ws://<host>:<PORT>/` (isti server kao HTTP; nema posebnog patha).

---

## 2. HTTP API

Svi JSON odgovori koriste `Content-Type: application/json; charset=utf-8` i `Cache-Control: no-store` gdje je primjenjivo.

### `GET /health`

- **200**: `{ "status": "ok" }` — provjera da proces radi.

### `GET /api/room-code`

- **200**: `{ "code": "<16 znakova>" }` — server generira **jedinstveni** kod i **rezervira** ga kratko (oko 5 minuta) dok klijent ne napravi `join` preko WebSocketa.
- **500**: `{ "error": "could_not_allocate_code" }`

### `GET /api/room-code/check?code=<kod>`

Provjera je li kod zauzet (aktivna sesija u RAM-u, zapis u bazi ili kratka rezervacija).

- `code` je **obavezan** query parametar.
- **400** ako `code` nedostaje.
- **200** za nevaljan format (kod mora biti točno **16** printable ASCII znakova, regex `[\x20-\x7E]{16}`):

```json
{
  "code": "...",
  "valid": false,
  "available": false,
  "occupied": true,
  "reason": "invalid_format",
  "message": "Code must be exactly 16 printable ASCII characters"
}
```

- **200** za valjan format:

```json
{
  "code": "...",
  "valid": true,
  "occupied": true,
  "available": false,
  "sources": {
    "inMemorySession": true,
    "inDatabase": true,
    "reserved": false
  }
}
```

`available === !occupied`.

### `POST /api/room-code/check`

- Tijelo: `Content-Type: application/json`, `{ "code": "<string>" }`.
- Ista logika i polja kao GET; **400** ako JSON nije valjan ili `code` nedostaje.

### `GET /api/rooms`

- **200**:

```json
{
  "rooms": [ /* aktivne sobe iz RAM-a */ ],
  "database": [ /* redovi iz SQLite */ ]
}
```

**`rooms`** (jedan element po aktivnoj sesiji):

| Polje | Tip | Opis |
|-------|-----|------|
| `pin` | string | 16-znakovni kod sobe |
| `type` | `"direct"` \| `"group"` | Način rada |
| `clientCount` | number | Broj povezanih WebSocket klijenata |
| `createdAt` | string (ISO) | Vrijeme nastanka sesije |
| `pinLocked` | boolean | U **direct** sobi: `true` kad je jedan peer otišao i PIN je zaključan za nove dok zadnji ne ode |
| `hibernated` | boolean | `true` kad su oba klijenta u **direct** sobi poslala `e2e_ready` (standby, manje DB upisa) |

**`database`**: snimak tablice `sessions` (npr. `pin`, `type`, `createdAt`, `renewCount`, `clientCount`, `updatedAt`).

**Napomena:** Endpoint nema autentikacije u kodu — u produkciji ograniči pristup (npr. samo interna mreža ili reverse proxy).

### Admin: dnevnik po sobi i prekid veze (web na `GET /`)

Na početnoj stranici (`/`) tablica aktivnih soba ima po redu: **Konzola** (otvara **SSE** tok događaja samo za taj PIN), **Prekini A** / **Prekini B** (samo **direct**: prvi spojeni = A, drugi = B; nasilno zatvara taj WebSocket).

- **`GET /api/rooms/:pin/events`** — JSON `{ "pin", "events": [ { "ts", "kind", "message" } ] }` (povijest u memoriji servera).
- **`GET /api/rooms/:pin/events/stream`** — **Server-Sent Events**; prvo se pošalje cijela povijest, zatim novi redovi uživo.
- **`POST /api/rooms/:pin/disconnect`** — tijelo `{ "slot": "first" | "second" }` (isto značenje kao A/B).

Ako je postavljen `ADMIN_TOKEN`, ovi endpointi zahtijevaju autentikaciju (Bearer / `X-Admin-Token`; za EventSource u pregledniku možeš dodati `?admin_token=` na stream URL — vidljivo u URL-u, pa u produkciji radije proxy ili isti origin bez tokena na javnoj mreži).

Događaji uključuju: otvaranje sesije, join strane A/B, relay `signal`/`msg`, `ping_self` / `peer_ping` / `peer_pong`, `e2e_ready`, odlazak, `close_session`, admin prekid.

---

## 3. WebSocket — cjelokupni tijek

### 3.1. Faza 1: plaintext (prije klijentskog ključa)

Poruke su **JSON string** u tekstu WebSocket okvira, **ne** šifrirane.

| `t` | Smjer | Opis |
|-----|--------|------|
| `ping` | klijent → server | Odgovor: `{ "t": "pong", "alive": true }` |
| `get_server_key` | klijent → server | Odgovor: `{ "t": "server_key", "publicKey": "<base64>" }` (serverov `crypto_box` javni ključ) |
| `client_key` | klijent → server | Tijelo: `{ "t": "client_key", "publicKey": "<base64>" }` — klijentov `crypto_box` javni ključ (točno `crypto_box_PUBLICKEYBYTES` bajtova nakon dekodiranja). Odgovor: `{ "t": "client_key_ack", "ok": true }` ili `{ "t": "error", "reason": "invalid_client_key", ... }` |

**Bez** uspješnog `client_key` server na daljnje poruke (osim gore) odgovara plaintext:

```json
{ "t": "error", "reason": "key_exchange_required", "message": "Send get_server_key then client_key first" }
```

### 3.2. Faza 2: box kanal (nakon `client_key`)

Sve poruke koje nisu eksplicitno dopuštene kao plaintext moraju biti oblika:

```json
{
  "t": "box",
  "nonce": "<base64>",
  "c": "<base64>"
}
```

- **nonce**: točno `crypto_box_NONCEBYTES` bajtova nakon dekodiranja iz base64.
- **c**: ciphertext od **JSON stringa** unutarnjeg payloada (`inner`), kriptiran s **libsodium `crypto_box`**:
  - pošiljatelj: klijent (tajni ključ klijenta + javni ključ servera),
  - primatelj: server.

Maksimalna veličina ciphertexta na serveru: **512 KiB** (zaštita od DoS).

Unutarnji JSON (`inner`) mora biti objekt s **`t` string** (tip poruke). Server dekriptira, parsira JSON i rutira prema `inner.t`.

Odgovori servera u ovoj fazi su također **`{ "t": "box", "nonce", "c" }`** — klijent dekriptira istim `crypto_box` obrnutim smjerom (server šalje kao pošiljatelj prema klijentu).

Ako klijent pošalje nešto što nije `box` nakon key exchangea:

```json
{ "t": "error", "reason": "encryption_required", ... }
```

(plaintext `error` — klijent nema još uvijek zaštićen kanal za čitanje ako nije implementiran; u praksi nakon `client_key` server koristi `sendSecure` za većinu odgovora, ali početna greška `key_exchange_required` je plaintext.)

---

## 4. Unutarnji tipovi (`inner.t`) nakon dekriptiranja

Svi zahtijevaju valjan **`code`** (PIN sobe): točno **16** printable ASCII znakova, regex `^[\x20-\x7E]{16}$`.

### `join`

```json
{ "t": "join", "code": "<16 znakova>", "mode": "direct" }
```

`mode` je opcionalan; zadano `"direct"`. Moguće vrijednosti: `"direct"`, `"group"`.

- **Prvi** klijent koji otvori sesiju s tim kodom određuje `mode` (nakon toga se tip sesije ne mijenja).
- **Direct**: najviše 2 klijenta; treći dobiva grešku `room_full`.
- **Group**: više klijenata u istoj sobi.

Uspjeh — server šalje (box):

```json
{
  "t": "joined",
  "code": "...",
  "mode": "direct" | "group",
  "roomState": "waiting_peer" | "connected" | "active",
  "peersInRoom": <number>
}
```

- Direct: `waiting_peer` dok jedan, `connected` kad su oba.
- Group: `active`.

Kad u **direct** sobi drugi klijent uđe, **oba** dobiju dodatno:

```json
{
  "t": "session_ready",
  "code": "...",
  "roomState": "connected",
  "peersInRoom": 2
}
```

Moguće greške (box): `invalid_code`, `pin_occupied`, `room_full` (vidi odjeljak Greške).

### `signal`

WebRTC ili drugi signal kroz server (relay svim drugim peerovima u sobi).

```json
{ "t": "signal", "code": "<16>", ... }
```

- Klijent mora biti **u sobi** (`join` s istim `code`).
- Server šalje isti payload (uključujući `t`, `code`, dodatna polja) drugim klijentima u sobi.
- Prije relaya: ako je soba hibernirana, **budi** se (hibernacija).
- Greška: `not_in_room`, `invalid_code`.

### `msg`

Relay poruka (npr. E2E ciphertext preko servera).

```json
{ "t": "msg", "code": "<16>", ... }
```

- Isto kao `signal`: broadcast drugima u sobi; `wake` ako hibernirano.
- Greška: `not_in_room`, `invalid_code`.

### `close_session`

```json
{ "t": "close_session", "code": "<16>" }
```

Zatvara cijelu sobu. Svi klijenti u sobi dobiju (box):

```json
{ "t": "session_closed", "code": "<16>", "closedBy": "self" | "peer" }
```

Inicijator: `closedBy: "self"`, ostali: `"peer"`. Sesija se briše iz RAM-a i baze.

### `ping_self`

```json
{ "t": "ping_self", "code": "<16>" }
```

Odgovor:

```json
{
  "t": "ping_self_ack",
  "category": "ping_self",
  "code": "<16>",
  "roomType": "direct" | "group",
  "roomState": "waiting_peer" | "connected" | "active",
  "peersInRoom": <number>
}
```

Budi hiberniranu sobu ako je potrebno.

### `peer_ping` / `peer_pong`

Relay za ping drugog peera.

```json
{ "t": "peer_ping", "code": "<16>", "nonce": "...", "ts": 1234567890 }
{ "t": "peer_pong", "code": "<16>", "nonce": "...", "ts": 1234567890 }
```

`nonce`/`ts` su opcionalni ako ih nema u payloadu.

- Zahtijeva **barem 2** klijenta u sobi; inače `peer_not_ready`.
- Broadcast: `{ "t": "peer_ping" | "peer_pong", "category": "ping_peer", "code", ... }`, `wake` ako hibernirano.

### `e2e_ready`

Javljanje da su klijenti prešli na **izravni E2E** kanal (bez relaya preko servera za sadržaj).

```json
{ "t": "e2e_ready", "code": "<16>" }
```

- Samo **direct** soba s **točno 2** peer-a.
- Prvi koji pošalje dobije:

```json
{ "t": "e2e_ready_ack", "code": "<16>", "hibernated": false, "pendingPeer": true }
```

- Kad i drugi pošalje, **oba** dobiju:

```json
{ "t": "e2e_ready_ack", "code": "<16>", "hibernated": true }
```

- Sesija označava `hibernated = true` (manje SQLite upisa dok nema aktivnosti).
- Bilo koji `signal`, `msg`, `ping_self`, `peer_ping`, `peer_pong` ili novi **join** u grupu (hibernacija) ponovno **budi** sesiju.

Greške: `invalid_code`, `not_in_room`, `e2e_ready_invalid`.

### Nepoznat `inner.t`

```json
{ "t": "error", "reason": "unknown_type" }
```

### Zabranjeno unutar boxa

`inner.t === "ping"` vraća grešku `ping_must_be_plaintext` — ping mora biti plaintext izvan boxa.

---

## 5. Greške (`reason`)

Česti kodovi u **box** odgovorima:

| `reason` | Značenje |
|----------|-----------|
| `invalid_code` | PIN nije 16 printable ASCII znakova |
| `not_in_room` | WebSocket nije u toj sobi (npr. `signal`/`msg` bez `join`) |
| `encryption_required` | Poslan ne-box nakon key exchangea |
| `decrypt_failed` | Loš nonce/ciphertext ili JSON |
| `invalid_inner` | Unutarnji JSON nema `t` string |
| `invalid_client_key` | `client_key` nevaljan |
| `key_exchange_required` | Rano slanje prije `client_key` |
| `room_full` | Direct soba već ima 2 klijenta |
| `pin_occupied` | Direct PIN zaključan za nove dok zadnji ne ode |
| `peer_not_ready` | Manje od 2 peera u sobi |
| `e2e_ready_invalid` | `e2e_ready` samo za direct s 2 peera |
| `unknown_type` | Nepoznat `inner.t` |

---

## 6. Minimalni algoritam klijenta (libsodium)

1. **WebSocket** → otvori vezu.
2. Plaintext: `get_server_key` → spremi `serverPk` (base64 → bytes).
3. Generiraj `crypto_box` keypair na klijentu; pošalji `client_key` s `publicKey` (base64).
4. Za svaku sljedeću poruku: sastavi `inner` objekt, JSON string, `crypto_box_easy` s `(plain, nonce, serverPk, clientSk)`, pošalji `{ t: "box", nonce, c }`.
5. Na primanje: ako `t === "box"`, dekriptiraj s `(c, nonce, clientPk, serverSk)` → parsiraj JSON.
6. Redoslijed poslovne logike: `join` → čekaj `joined` (i `session_ready` u directu) → `signal` / `msg` / ostalo.

Biblioteka: **libsodium** (npr. `libsodium-wrappers` u Nodeu, `libsodium.js` u pregledniku) — isti API kao u server testovima (`crypto_box_easy`, `crypto_box_open_easy`, `randombytes_buf` za nonce).

---

## 7. CORS i cross-origin

HTTP server **ne** postavlja CORS zaglavlja. Ako frontend i API nisu isti origin (npr. Vite na `localhost:5173`, API na `localhost:3000`), preglednik će blokirati `fetch` dok se na server ili proxy ne doda CORS. Isti origin (npr. serviranje `index.html` s istog Node servera) radi bez dodatnog podešavanja.

---

## 8. Izvor istine u kodu

| Područje | Datoteka |
|----------|----------|
| Ulaz (HTTP + WS bootstrap) | `src/server.js` |
| HTTP pipeline (lanac ruta) | `src/http/HttpPipeline.js`, `src/http/buildHttpListener.js` |
| Pojedinačne HTTP rute | `src/http/routes/*.js` (npr. `HealthRoute`, `RoomCodeCheckGetRoute`, `RoomsListRoute`, `IndexHtmlRoute`) |
| HTTP pomoć | `src/http/httpUtils.js` |
| WebSocket životni ciklus veza | `src/ws/WebSocketManager.js` |
| Graceful shutdown | `src/bootstrap/shutdown.js` |
| Konstante soba (rezervacija PIN-a) | `src/core/roomConstants.js` |
| Dnevnik po sobi (za admin konzolu) | `src/core/roomDiagnostics.js` |
| Admin HTTP (events / SSE / disconnect) | `src/http/routes/RoomAdminApiRoute.js` |
| WS routing (box / inner.t) | `src/core/messageRouter.js` |
| Box kripto | `src/crypto/boxChannel.js`, `src/crypto/serverIdentity.js` |
| Sobe | `src/core/roomManager.js` |
| SQLite | `src/db/sessionStore.js` |
| Handlers | `src/handlers/*.js` |
| Integracijski testovi (primjeri protokola) | `tests/integrationSession.test.js` |

Ažuriraj ovaj README kad mijenjaš protokol ili dodaješ nove `inner.t` tipove.
