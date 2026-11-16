/** Server-created ownership binding for new reports. Legacy rows remain unbound. */
export async function recordReportOwner(db: D1Database, reportId: number, ownerSlot: boolean, userId: number | null): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS work_status_report_owners (
    report_id INTEGER PRIMARY KEY REFERENCES user_reports(id) ON DELETE CASCADE,
    user_id INTEGER,
    owner_slot INTEGER CHECK(owner_slot IS NULL OR owner_slot = 1),
    CHECK ((user_id IS NOT NULL AND user_id > 0 AND owner_slot IS NULL) OR
           (user_id IS NULL AND owner_slot IS NOT NULL AND owner_slot = 1))
  )`).run();
  await db.prepare('INSERT INTO work_status_report_owners (report_id, user_id, owner_slot) VALUES (?, ?, ?)')
    .bind(reportId, ownerSlot ? null : userId, ownerSlot ? 1 : null).run();
}
