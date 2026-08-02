# PhotoGenius AI — Backend Admin Implementation Prompt

Copy the complete prompt below into the backend task. Implement only the admin capability described here. Do not change the existing public capture workflow or its response contract.

---

You are working on the existing PhotoGenius AI Spring Boot backend.

The deployed React frontend is:

```text
https://bestue.netlify.app
```

The existing public endpoint must remain unchanged:

```text
POST /api/v1/captures
```

It currently stores the photo plus GPS fields when provided, or Geo-IP/raw-IP information when GPS is unavailable. Do not rename, remove, or change this endpoint, its validation, storage behavior, or its `201` response containing `saved: true`.

Implement a secure, read-only admin API for the new frontend admin terminal.

## 1. Authentication

Create:

```http
POST /api/v1/admin/auth/login
Content-Type: application/json

{
  "username": "admin username",
  "password": "admin password"
}
```

Successful response (`200 OK`):

```json
{
  "accessToken": "short-lived signed token",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "admin": {
    "username": "admin username"
  }
}
```

Requirements:

- Store no admin password or secret in frontend code.
- Read admin username and a BCrypt password hash from backend environment/configuration, for example `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`.
- Never store or log the plain password.
- Compare passwords with BCrypt.
- Return a cryptographically signed, short-lived token (recommended lifetime: 15 minutes).
- Keep the signing secret only in a backend secret such as `ADMIN_JWT_SECRET`.
- Accept the token only through `Authorization: Bearer <token>`.
- Rate-limit login attempts by IP and username.
- Use the same generic `401` response for unknown username and wrong password.
- Do not expose whether the username exists.
- All `/api/v1/admin/**` endpoints except `/api/v1/admin/auth/login` require the admin role.
- Public `/api/v1/captures` must remain publicly callable as it is now.

Problem responses must use the existing `application/problem+json` style and include `message` or `detail`.

## 2. Paginated capture records

Create:

```http
GET /api/v1/admin/captures?page=0&size=20&sort=createdAt,desc&query=&locationSource=ALL
Authorization: Bearer <token>
```

Rules:

- Default size is 20; maximum size is 100.
- Always support newest-first sorting.
- `query` optionally searches capture ID, original filename, IP address, city, region, and country.
- `locationSource` optionally filters `GPS`, `GEO_IP`, or `RAW_IP`; omit filtering for `ALL`.
- Use repository/database pagination. Do not load the entire table into memory.
- This endpoint is read-only.

Response (`200 OK`):

```json
{
  "content": [
    {
      "id": "capture UUID or database ID",
      "saved": true,
      "fileName": "camera-123.jpg",
      "contentType": "image/jpeg",
      "fileSizeBytes": 245678,
      "width": 1280,
      "height": 960,
      "createdAt": "2026-08-02T12:30:00Z",
      "latitude": 28.6139,
      "longitude": 77.2090,
      "accuracy": 18.5,
      "locationSource": "GPS",
      "ipAddress": "public client IP",
      "address": "resolved address when available",
      "city": "city when available",
      "region": "region when available",
      "country": "country when available",
      "userAgent": "request user agent when saved",
      "photoAvailable": true
    }
  ],
  "number": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1,
  "summary": {
    "totalCaptures": 1,
    "capturesToday": 1,
    "gpsCaptures": 1,
    "ipFallbackCaptures": 0,
    "storageBytes": 245678
  }
}
```

Map the response to the real existing capture entity/table. Return every useful non-secret field already saved for a capture. Use `null` for unavailable optional values. Never return passwords, token data, database credentials, cloud-storage credentials, private server paths, stack traces, or internal exception details.

If the existing model uses `captureId` instead of `id`, the frontend supports either, but `id` is preferred.

## 3. Protected photo content

Create:

```http
GET /api/v1/admin/captures/{captureId}/photo
Authorization: Bearer <token>
```

Requirements:

- Look up the existing saved photo by capture ID.
- Return the actual bytes with the correct stored `Content-Type` (`image/jpeg`, `image/png`, or `image/webp`).
- Add `Content-Disposition: inline` with a safe filename.
- Add `Cache-Control: no-store, private`.
- Return `404 application/problem+json` when the capture or photo is missing.
- Do not expose a public unauthenticated storage URL.
- Stream the resource; do not unnecessarily copy a large photo several times in memory.

## 4. Client IP correctness

The backend is deployed behind Render/proxies. Resolve the client IP only from trusted proxy headers configured for the deployment. Do not blindly trust arbitrary forwarded headers. Preserve the current raw IP/Geo-IP capture behavior while making it proxy-aware if it is not already.

## 5. CORS and security headers

Allow the exact origins:

```text
https://bestue.netlify.app
http://localhost:5173
```

For admin APIs allow:

```text
Methods: GET, POST, OPTIONS
Headers: Authorization, Content-Type, Accept
```

Do not use wildcard origins together with credentials. Add appropriate security headers and `Cache-Control: no-store` to login and admin JSON responses.

## 6. Required verification

Add automated tests covering:

- correct login returns a short-lived token;
- wrong username/password returns the same `401` problem response;
- login rate limiting;
- admin capture list returns `401` without a token;
- invalid/expired token returns `401`;
- non-admin token returns `403`;
- authorized pagination, search, filter, and newest-first sorting;
- authorized photo response returns the correct bytes and MIME type;
- missing photo returns `404`;
- public `POST /api/v1/captures` still behaves exactly as before;
- CORS preflight succeeds from `https://bestue.netlify.app` with the `Authorization` header.

Run the complete existing backend test suite. Provide the environment variable names required for Render, but never commit their values.

Do not add delete/edit/export actions. This admin release is intentionally read-only.

---

The frontend is already wired to these three endpoints:

```text
POST /api/v1/admin/auth/login
GET  /api/v1/admin/captures
GET  /api/v1/admin/captures/{captureId}/photo
```
