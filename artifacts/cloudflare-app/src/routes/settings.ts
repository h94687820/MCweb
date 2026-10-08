import { Hono } from "hono";
import { UpdateSettingsBody } from "@workspace/api-zod";
import {
  listRecords,
  createRecord,
  patchRecord,
  setUniqueFields,
  isDuplicateFieldError,
} from "../lib/baas";
import { getAuthUserId, requireAuth } from "../lib/auth";
import type { Bindings, Variables } from "../env.d";

const COLLECTION = "settings";

type SettingsData = {
  theme: string;
  darkMode: boolean;
  virusTotalEnabled: boolean;
  ownerUserId?: string | null;
};

const settings = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function toResponse(record: { id: number; data: SettingsData }) {
  const { ownerUserId: _ownerUserId, ...settingsData } = record.data;
  return { id: record.id, ...settingsData };
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
async function ensureSettingsSchema(env: Bindings) {
  if (schemaEnsured) return;
  await setUniqueFields(env, COLLECTION, ["ownerUserId"]);
  schemaEnsured = true;
}

async function getSettingsForUser(env: Bindings, userId: string) {
  await ensureSettingsSchema(env);
  const all = await listRecords<SettingsData>(env, COLLECTION);
  const personal = all.find((record) => record.data.ownerUserId === userId);
  if (personal) return personal;

  const legacy = all.find((record) => !record.data.ownerUserId);
  const initial = legacy?.data ?? defaultSettings().data;
  try {
    return await createRecord<SettingsData>(env, COLLECTION, {
      theme: initial.theme,
      darkMode: initial.darkMode,
      virusTotalEnabled: initial.virusTotalEnabled,
      ownerUserId: userId,
    });
  } catch (error) {
    if (!isDuplicateFieldError(error)) throw error;
    const latest = await listRecords<SettingsData>(env, COLLECTION);
    const raced = latest.find((record) => record.data.ownerUserId === userId);
    if (raced) return raced;
    throw error;
  }
}

async function getPublicSettings(env: Bindings) {
  const all = await listRecords<SettingsData>(env, COLLECTION);
  return all.find((record) => !record.data.ownerUserId) ?? defaultSettings();
}

settings.get("/settings", async (c) => {
  const authorization = c.req.header("authorization");
  const userId = await getAuthUserId(c);
  if (authorization && !userId) {
    return c.json({ error: "Unauthorized — please sign in" }, 401);
  }
  const result = userId
    ? await getSettingsForUser(c.env, userId)
    : await getPublicSettings(c.env);
  return c.json(toResponse(result));
});

settings.put("/settings", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parseResult = UpdateSettingsBody.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "Invalid settings" }, 400);
  }

  const current = await getSettingsForUser(c.env, c.get("userId"));
  const updated = await patchRecord<SettingsData>(c.env, COLLECTION, current.id, parseResult.data);

  return c.json(toResponse(updated));
});

export default settings;
