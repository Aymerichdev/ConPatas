require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// -----------------------------------------------------------------------------
// Optional SendGrid setup
// -----------------------------------------------------------------------------
let sgMail = null;
try {
  /* eslint-disable global-require */
  sgMail = require('@sendgrid/mail');
  /* eslint-enable global-require */
} catch (err) {
  console.warn('Optional dependency @sendgrid/mail not installed — email sending disabled');
}

const isEmailConfigured = Boolean(
  sgMail && process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM
);

if (sgMail) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set — email sending will fail');
  } else {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }
}

// -----------------------------------------------------------------------------
// Firebase Admin initialization helpers
// -----------------------------------------------------------------------------
function normalizeServiceAccount(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const copy = { ...obj };
  if (typeof copy.private_key === 'string') {
    copy.private_key = copy.private_key.replace(/\\n/g, '\n');
  }
  return copy;
}

function loadServiceAccountFromEnv() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const raw = rawJson || rawB64;
  if (!raw) return null;

  try {
    const jsonString = raw === rawB64 ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    const parsed = JSON.parse(jsonString);
    return normalizeServiceAccount(parsed);
  } catch (err) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env variable:', err.message);
    return null;
  }
}

function loadServiceAccountFromFile() {
  const candidates = [];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    candidates.push(process.env.FIREBASE_SERVICE_ACCOUNT_FILE);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    candidates.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  candidates.push(path.join(__dirname, 'serviceAccount.json'));

  for (const filePath of candidates) {
    if (!filePath) continue;
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!fs.existsSync(absolutePath)) continue;
    try {
      const contents = fs.readFileSync(absolutePath, 'utf8');
      const parsed = JSON.parse(contents);
      console.log(`Loaded Firebase service account from ${absolutePath}`);
      return normalizeServiceAccount(parsed);
    } catch (err) {
      console.error(`Failed to read service account file ${absolutePath}:`, err.message);
    }
  }
  return null;
}

function buildFirebaseOptions() {
  const serviceAccount = loadServiceAccountFromEnv() || loadServiceAccountFromFile();
  const projectId = process.env.FIREBASE_PROJECT_ID
    || serviceAccount?.project_id
    || 'conpatas-f7d07';
  const databaseURL = process.env.FIREBASE_DATABASE_URL
    || `https://${projectId}-default-rtdb.firebaseio.com`;

  const options = { projectId, databaseURL };

  if (serviceAccount) {
    options.credential = admin.credential.cert(serviceAccount);
    console.log('Firebase Admin initialized with explicit service account credentials');
  } else {
    try {
      options.credential = admin.credential.applicationDefault();
      console.log('Firebase Admin initialized with application default credentials');
    } catch (err) {
      console.warn('Application default credentials unavailable. Some Firestore calls may fail:', err.message);
    }
  }

  return options;
}

admin.initializeApp(buildFirebaseOptions());

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json({ limit: process.env.REQUEST_LIMIT || '1mb' }));

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
async function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.*)$/i);
  if (!match) {
    req.user = null;
    return next();
  }
  const idToken = match[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
  } catch (err) {
    console.warn('Invalid ID token', err);
    req.user = null;
  }
  return next();
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function resolveImage(entry) {
  if (!entry) return undefined;
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const it of entry) {
      const resolved = resolveImage(it);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (typeof entry === 'object') {
    return entry.url || entry.src || entry.path || entry.fullPath || entry.storagePath;
  }
  return undefined;
}

function mapDogDocument(doc) {
  const data = doc.data() || {};
  const primaryImage = resolveImage(data.image) || resolveImage(data.images) || '';
  const imagesArray = Array.isArray(data.images)
    ? data.images.map(resolveImage).filter(Boolean)
    : primaryImage ? [primaryImage] : [];

  return {
    id: doc.id,
    name: data.name || '',
    age: data.age || '',
    breed: data.breed || '',
    size: data.size || 'mediano',
    description: data.description || '',
    image: primaryImage,
    images: imagesArray,
    personality: Array.isArray(data.personality) ? data.personality : [],
    ownerEmail: data.ownerEmail || null,
    ownerId: data.ownerId || null,
    ownerName: data.ownerName || null,
    createdAt: data.createdAt || null
  };
}

async function getDogById(dogId) {
  if (!dogId) return null;

  try {
    const ref = db.collection('Perro').doc(dogId);
    const snap = await ref.get();
    if (snap.exists) return mapDogDocument(snap);
  } catch (err) {
    console.warn('getDogById: fetch by doc id failed, trying field query', err);
  }

  try {
    const snapshot = await db.collection('Perro').where('id', '==', dogId).limit(1).get();
    if (!snapshot.empty) {
      return mapDogDocument(snapshot.docs[0]);
    }
  } catch (err) {
    console.error('getDogById: field query failed', err);
    throw err;
  }

  return null;
}

async function listDogs({ ownerEmail }) {
  let snapshot;
  if (ownerEmail) {
    snapshot = await db.collection('Perro').where('ownerEmail', '==', ownerEmail).get();
  } else {
    snapshot = await db.collection('Perro').get();
  }
  return snapshot.docs.map(mapDogDocument);
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/dogs', async (req, res) => {
  try {
    const ownerEmail = req.query.ownerEmail ? String(req.query.ownerEmail) : undefined;
    const dogs = await listDogs({ ownerEmail });
    res.json({ dogs });
  } catch (err) {
    console.error('Error in GET /api/dogs', err);
    res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/dogs/:id', async (req, res) => {
  try {
    const dog = await getDogById(req.params.id);
    if (!dog) return res.status(404).json({ error: 'not_found' });
    return res.json({ dog });
  } catch (err) {
    console.error('Error in GET /api/dogs/:id', err);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/dogs', verifyToken, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'auth_required' });
  }

  try {
    const { name, age, breed, size, description, image, images, personality } = req.body || {};
    if (!name || !description || !image) {
      return res.status(400).json({ error: 'name, description and image are required' });
    }

    const docData = {
      name,
      age: age || '',
      breed: breed || '',
      size: size || 'mediano',
      description,
      image,
      images: Array.isArray(images) ? images : image ? [image] : [],
      personality: Array.isArray(personality) ? personality : [],
      ownerEmail: req.user.email || null,
      ownerId: req.user.uid || null,
      ownerName: req.user.name || req.user.displayName || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (!docData.ownerEmail && req.body?.ownerEmail) {
      docData.ownerEmail = String(req.body.ownerEmail);
    }
    if (!docData.ownerName && req.body?.ownerName) {
      docData.ownerName = String(req.body.ownerName);
    }

    const ref = await db.collection('Perro').add(docData);
    const snap = await ref.get();
    return res.status(201).json({ dog: mapDogDocument(snap) });
  } catch (err) {
    console.error('Error creating dog publication', err);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/applications', verifyToken, async (req, res) => {
  try {
    const { dogId, form } = req.body || {};
    if (!dogId || !form) return res.status(400).json({ error: 'dogId and form required' });

    const dog = await getDogById(dogId);
    if (!dog) return res.status(404).json({ error: 'Dog not found' });

    const ownerEmail = dog.ownerEmail || dog.owner || dog.email;
    if (!ownerEmail) return res.status(400).json({ error: 'Owner email not available on dog record' });

    const subject = `Solicitud de adopción para ${dog.name || 'un perro'}`;
    const html = `
      <p>Tienes una nueva solicitud de adopción para <strong>${escapeHtml(dog.name || '')}</strong>.</p>
      <h3>Datos del aplicante</h3>
      <ul>
        <li><strong>Nombre:</strong> ${escapeHtml(form.fullName || '')}</li>
        <li><strong>Email:</strong> ${escapeHtml(form.email || '')}</li>
        <li><strong>Teléfono:</strong> ${escapeHtml(form.phone || '')}</li>
      </ul>
      <h3>Formulario completo</h3>
      <pre style="white-space:pre-wrap;">${escapeHtml(JSON.stringify(form, null, 2))}</pre>
    `;

    if (isEmailConfigured) {
      const msg = {
        to: ownerEmail,
        from: process.env.EMAIL_FROM,
        subject,
        html
      };
      await sgMail.send(msg);
    } else {
      if (!sgMail) console.warn('SendGrid module not available; skipping email send');
      else if (!process.env.SENDGRID_API_KEY) console.warn('SENDGRID_API_KEY not configured; skipping email send');
      else console.warn('EMAIL_FROM not configured; skipping email send');
    }

    await db.collection('Applications').add({
      dogId,
      dogName: dog.name || null,
      ownerEmail: ownerEmail || null,
      form,
      applicantUid: req.user?.uid ?? null,
      applicantEmail: req.user?.email ?? form.email ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error in /api/applications', err);
    return res.status(500).json({ error: 'internal' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Backend listening on', PORT));
