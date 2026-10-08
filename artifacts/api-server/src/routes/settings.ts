import { Router } from "express";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { getFirebaseUserId, requireFirebaseAuth } from "../lib/firebaseAuth";
import {
  listRecords,
  createRecord,
  patchRecord,
  setUniqueFields,
  isDuplicateFieldError,
} from "../lib/baas";

const router = Router();

const COLLECTION = "settings";

type SettingsData = {
  theme: string;
  darkMode: boolean;
  virusTotalEnabled: boolean;
  ownerUserId?: string | null;
};

function toResponse(record: { id: number; data: SettingsData }) {
  const { ownerUserId: _ownerUserId, ...settings } = record.data;
  return { id: record.id, ...settings };
}

function defaultSettings(id = 0): { id: number; data: SettingsData } {
  return {
    id,
    data: {
      theme: "default",
      darkMode: true,
      virusTotalEnabled: true,
      ownerUserId: null,
    },
  };
}

let schemaEnsured = false;
async function ensureSettingsSchema() {
  if (schemaEnsured) return;
  await setUniqueFields(COLLECTION, ["ownerUserId"]);
  schemaEnsured = true;
}

async function getSettingsForUser(userId: string) {
  await ensureSettingsSchema();
  const all = await listRecords<SettingsData>(COLLECTION);
  const personal = all.find((record) => record.data.ownerUserId === userId);
  if (personal) return personal;

  // Use the old shared row only as the initial preference seed. Future writes
  // are scoped to this user and cannot change another user's appearance.
  const legacy = all.find((record) => !record.data.ownerUserId);
  const initial = legacy?.data ?? defaultSettings().data;
  try {
    return await createRecord<SettingsData>(COLLECTION, {
      theme: initial.theme,
      darkMode: initial.darkMode,
      virusTotalEnabled: initial.virusTotalEnabled,
      ownerUserId: userId,
    });
  } catch (error) {
    if (!isDuplicateFieldError(error)) throw error;
    const latest = await listRecords<SettingsData>(COLLECTION);
    const raced = latest.find((record) => record.data.ownerUserId === userId);
    if (raced) return raced;
    throw error;
  }
}

async function getPublicSettings() {
  const all = await listRecords<SettingsData>(COLLECTION);
  return all.find((record) => !record.data.ownerUserId) ?? defaultSettings();
}

router.get("/settings", async (req, res) => {
  const authorization = req.get("authorization");
  const userId = await getFirebaseUserId(req);
  if (authorization && !userId) {
    return res.status(401).json({ error: "Unauthorized — please sign in" });
  }
  const settings = userId ? await getSettingsForUser(userId) : await getPublicSettings();
  return res.json(toResponse(settings));
});

router.put("/settings", requireFirebaseAuth, async (req, res) => {
  const parseResult = UpdateSettingsBody.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: "Invalid settings" });

  const current = await getSettingsForUser((req as any).userId);
  const updated = await patchRecord<SettingsData>(COLLECTION, current.id, parseResult.data);
  return res.json(toResponse(updated));
});

export default router;
