import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { canOpenPhoneClients, canOpenPhoneEmployees, phoneBackTarget } from '../mobile/PhoneDock';
import PhoneClients, { filterMobileClients, mapClientRow, PHONE_CLIENTS_PAGE_SIZE } from '../mobile/PhoneClients';
import {
  filterMobileEmployees,
  mapEmployeeRow,
  PHONE_EMPLOYEES_PAGE_SIZE,
  PhoneEmployeeDirectory,
} from '../mobile/PhoneEmployees';

describe('Part 2 — /m/clients and /m/employees parity with Android', () => {
  it('enforces role gating without widening access', () => {
    expect(canOpenPhoneClients('owner')).toBe(true);
    expect(canOpenPhoneClients('admin')).toBe(true);
    expect(canOpenPhoneClients('secretaire')).toBe(true);
    expect(canOpenPhoneClients('stock')).toBe(false);
    expect(canOpenPhoneClients('user')).toBe(false);

    expect(canOpenPhoneEmployees('owner')).toBe(true);
    expect(canOpenPhoneEmployees('admin')).toBe(true);
    expect(canOpenPhoneEmployees('secretaire')).toBe(false);
    expect(canOpenPhoneEmployees('stock')).toBe(false);
    expect(canOpenPhoneEmployees('user')).toBe(false);
  });

  it('maps client fields matching Android (nom, téléphone, email, ICE, adresse, limite de crédit, solde dû) and searches by name/phone/ICE', () => {
    const c1 = mapClientRow({
      id: 1,
      name: 'BatiMaroc SARL',
      phone: '0661001122',
      email: 'contact@batimaroc.ma',
      ice: '001122334455667',
      address: 'Zone Ind. El Jadida',
      credit_limit: 50000,
      unpaid_total: 12400,
    });
    const c2 = mapClientRow({
      id: 2,
      name: 'Marbre Sud',
      phone: '0522998877',
      ice: '009988776655443',
      credit_limit: 10000,
      balance: 0,
    });
    expect(c1.credit_limit).toBe(50000);
    expect(c1.balance_due).toBe(12400);
    expect(PHONE_CLIENTS_PAGE_SIZE).toBe(20);

    expect(filterMobileClients([c1, c2], '00112233')).toHaveLength(1);
    expect(filterMobileClients([c1, c2], '052299')).toEqual([c2]);
    expect(filterMobileClients([c1, c2], 'batimaroc')).toEqual([c1]);
  });

  it('maps employee directory + detail fields (contrat, salaire, CNSS, pièce d’identité) and routes back cleanly', () => {
    const e1 = mapEmployeeRow({
      id: 7,
      first_name: 'Karim',
      last_name: 'El Fassi',
      role_title: 'Magasinier',
      department: 'Logistique',
      contract_type: 'CDI',
      pay_amount: 4500,
      cnss_number: 'CNSS-889900',
      national_id: 'AB123456',
    });
    const e2 = mapEmployeeRow({
      id: 8,
      name: 'Salma Idrissi',
      role_title: 'Comptable',
      contract_type: 'CDD',
      pay_amount: 6500,
    });
    expect(e1.name).toBe('Karim El Fassi');
    expect(e1.cnss_number).toBe('CNSS-889900');
    expect(e1.national_id).toBe('AB123456');
    expect(PHONE_EMPLOYEES_PAGE_SIZE).toBe(20);
    expect(filterMobileEmployees([e1, e2], '889900', 'all')).toEqual([e1]);
    expect(filterMobileEmployees([e1, e2], '', 'Comptable')).toEqual([e2]);
    expect(phoneBackTarget('/m/employees/7')).toBe('/m/employees');

    const clientsHtml = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ['/m/clients'] }, createElement(PhoneClients, { onToast: () => {} })),
    );
    expect(clientsHtml).toContain('Clients');

    const empHtml = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ['/m/employees'] }, createElement(PhoneEmployeeDirectory)),
    );
    expect(empHtml).toContain('Employés');
  });
});
