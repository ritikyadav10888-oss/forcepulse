// npm run migrate | npm run seed   (reads DATABASE_URL and SEED_* from the repo's .env)
import { ensureSuperAdmin, migrateDb, openDb, seedReferenceData } from "./index";

async function main() {
  const command = process.argv[2];
  const handle = await openDb();
  try {
    await migrateDb(handle);
    if (command === "seed") {
      await seedReferenceData(handle.db);
      const email = process.env.SEED_SUPER_ADMIN_EMAIL;
      const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
      if (email && password) {
        const created = await ensureSuperAdmin(handle.db, email, password);
        console.log(created ? `Super admin created: ${email}` : `Super admin already exists: ${email}`);
      }
      console.log("Seed done.");
    } else {
      console.log("Migrations applied.");
    }
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
