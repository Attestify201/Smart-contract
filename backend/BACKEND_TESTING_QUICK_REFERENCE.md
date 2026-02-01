# Backend Testing - Quick Reference

Your backend is **production-ready** to test! Here's how to validate it works **without frontend**:

---

## 🚀 Fastest Way: cURL (2 minutes)

```bash
# Terminal 1: Start your backend
npm run dev

# Terminal 2: Test verification endpoint
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{
    "attestationId": 1,
    "proof": {"pi_a":[],"pi_b":[],"pi_c":[]},
    "publicSignals": ["hash1","hash2"],
    "userContextData": "0x1234567890123456789012345678901234567890"
  }'

# Terminal 2: Test check endpoint
curl -X POST http://localhost:3000/api/check-verification \
  -H "Content-Type: application/json" \
  -d '{"userId":"0x1234567890123456789012345678901234567890"}'
```

**You should see:**
- `POST /api/verify` → `{"status":"success","result":true}` or error message
- `POST /api/check-verification` → `{"verified":true,"userId":"0x..."}`

---

## 📦 Three Testing Tools Provided

| Tool | Best For | Command |
|------|----------|---------|
| **cURL** | Quick manual testing | `curl -X POST ...` |
| **Bash Script** | Automated testing | `./backend/test-backend.sh` |
| **Node Script** | Detailed testing | `node --loader ts-node/esm backend/test-backend.ts` |
| **Postman** | Visual testing | Import JSON collection |

---

## 📁 Files Created

1. **[TESTING.md](./TESTING.md)** - Complete testing guide with all details
2. **[test-backend.sh](./test-backend.sh)** - Automated bash testing script
3. **[test-backend.ts](./test-backend.ts)** - Node.js testing utility
4. **[Self-Protocol-Backend-Tests.postman_collection.json](./Self-Protocol-Backend-Tests.postman_collection.json)** - Postman collection
5. **[BACKEND_TESTING_QUICK_REFERENCE.md](./BACKEND_TESTING_QUICK_REFERENCE.md)** - This file

---

## ✅ Validation Checklist

Run these commands and verify responses:

### ✓ Can API be reached?
```bash
curl http://localhost:3000/api/verify -X POST
```
Should NOT say "Connection refused"

### ✓ Does /api/verify accept proofs?
```bash
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"attestationId":1,"proof":{},"publicSignals":[],"userContextData":"0xabc"}'
```
Should return `{"status":"...","result":...}`

### ✓ Does /api/check-verification check users?
```bash
curl -X POST http://localhost:3000/api/check-verification \
  -H "Content-Type: application/json" \
  -d '{"userId":"0xabc"}'
```
Should return `{"verified":true|false,"userId":"0xabc"}`

---

## 🎯 What's Tested

| Component | Status | Note |
|-----------|--------|------|
| Backend endpoints exist | ✅ | `/api/verify` and `/api/check-verification` |
| Accept POST requests | ✅ | Correct HTTP method and headers |
| Process proof data | ✅ | Stores by userIdentifier |
| Return verification status | ✅ | Returns verified true/false |
| Nullifier included | ✅ | For sybil resistance |
| Multiple users supported | ✅ | Each user stored independently |

---

## 📋 What Happens During Tests

1. **Setup**: Start your backend server
2. **Verify Test**: Simulates Self relayers sending proof → Backend stores it
3. **Check Test**: Simulates miniapp checking user → Backend returns status
4. **Multi-user Test**: Tests that multiple users can be verified independently

---

## 🔗 Flow Reference

```
User Flow:
  Frontend calls SelfAppBuilder deeplink
    ↓
  Opens Self app → User scans passport
    ↓
  Self relayers POST /api/verify with proof
    ↓
  Backend stores verification ← [TEST THIS]
    ↓
  Self app redirects to deeplinkCallback
    ↓
  Frontend calls POST /api/check-verification ← [TEST THIS]
    ↓
  Backend returns verified=true + nullifier
    ↓
  Frontend stores on-chain (optional)
```

---

## 🚨 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "Connection refused" | Backend not running | `npm run dev` |
| "404 Not Found" | Wrong endpoint path | Check route definitions in pages/api/ |
| "Proof validation failed" | Using dummy data (expected!) | Will work with real proofs from Self app |
| Empty `userId` in response | Endpoint not called | Ensure correct JSON body format |

---

## 📞 Ready for Frontend?

Once you confirm all tests pass, tell your frontend team:

**They need to implement:**
1. `SelfAppBuilder` with deeplink (no QR code)
2. `window.open(getUniversalLink(selfApp))` to open Self app
3. After user returns, call `POST /api/check-verification`
4. If `verified=true`, optionally store on-chain

**Your backend endpoints are ready:**
- ✅ `POST /api/verify` - accepts proofs from Self Protocol
- ✅ `POST /api/check-verification` - returns verification status

---

## 📚 See Also

- [SELF_INTEGRATION.md](./SELF_INTEGRATION.md) - Backend setup & flow details
- [TESTING.md](./TESTING.md) - Comprehensive testing guide
- [../contracts/SelfProtocolVerifier.sol](../contracts/SelfProtocolVerifier.sol) - On-chain verification contract
