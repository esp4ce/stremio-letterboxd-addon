# Backend tests

```
tests/
├── setup.ts                    # Vitest global setup (MSW, DB in-memory)
├── helpers/                    # Shared test utilities
│   ├── app-factory.ts          # buildTestApp() — isolated Fastify per test
│   ├── msw-server.ts           # MSW server with Letterboxd handlers
│   ├── db.ts                   # In-memory SQLite + seedUser()
│   └── fixtures/               # Frozen JSON payloads from Letterboxd client
├── unit/                       # Pure logic, no I/O
│   ├── lib/
│   └── modules/
├── integration/                # Services + routes with MSW mocks
│   ├── services/
│   ├── routes/
│   └── actions/
└── lib/
    └── memory-guard.test.ts    # Existing
```

Run: `npm run test:run`
