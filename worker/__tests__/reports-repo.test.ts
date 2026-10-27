import { describe, expect, it } from 'vitest';

import {
  REPORTS_REPO_DEFAULT,
  REPORTS_REPO_LEGACY,
  resolveReportsRepo,
} from '../lib/reports';

/**
 * v0.7 — crash/user reports come FROM the apps: GitHub issues must land in
 * the ANDROID repository, not the web project. The pre-0.7 default (web repo)
 * may still sit in app_config → it migrates on read.
 */
describe('resolveReportsRepo', () => {
  it('defaults to the android repository', () => {
    expect(REPORTS_REPO_DEFAULT).toBe('Etherealmber/atlas-commerce-android');
    expect(resolveReportsRepo(null)).toBe('Etherealmber/atlas-commerce-android');
    expect(resolveReportsRepo(undefined)).toBe('Etherealmber/atlas-commerce-android');
    expect(resolveReportsRepo('')).toBe('Etherealmber/atlas-commerce-android');
    expect(resolveReportsRepo('   ')).toBe('Etherealmber/atlas-commerce-android');
  });

  it('migrates the legacy web-repo default saved before 0.7', () => {
    expect(REPORTS_REPO_LEGACY).toBe('Etherealmber/atlas-commerce');
    expect(resolveReportsRepo('Etherealmber/atlas-commerce')).toBe('Etherealmber/atlas-commerce-android');
  });

  it('honors an explicit owner override (including other repos)', () => {
    expect(resolveReportsRepo('Etherealmber/atlas-commerce-android')).toBe('Etherealmber/atlas-commerce-android');
    expect(resolveReportsRepo('SomeOrg/other-repo')).toBe('SomeOrg/other-repo');
  });
});
