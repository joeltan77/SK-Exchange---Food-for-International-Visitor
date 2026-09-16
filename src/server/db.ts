import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { MenuItem, Order, OrderItem, StallMenu, OwnerAcknowledgement } from '../types';
import { INITIAL_STALL_MENU } from '../data/sampleMenu';

export interface DbOrderRow {
  id: string;
  publicOrderReference: string;
  idempotencyKey: string;
  visitorId: string;
  stallId: string;
  status: string;
  ownerAcknowledgement: OwnerAcknowledgement;
  ownerNote: string | null;
  subtotalKrw: number;
  totalKrw: number;
  createdAt: string;
  sentAt: string | null;
  acknowledgedAt: string | null;
  telegramMessageId: number | null;
  telegramChatId: string | null;
  deliveryMode: 'live' | 'mock';
  deliveryError: string | null;
  originalTranscript: string | null;
  specialRequestEnglish: string | null;
  specialRequestKorean: string | null;
  formattedKorean: string | null;
  isMockDemo: number;
}

export interface DbOrderItemRow {
  id: string;
  orderId: string;
  menuItemId: string;
  koreanNameSnapshot: string;
  englishNameSnapshot: string;
  unitPriceKrwSnapshot: number;
  quantity: number;
  lineTotalKrw: number;
  specialRequest: string | null;
}

export class OrderDatabase {
  private db: DatabaseSync;

  constructor(dbFilePath?: string) {
    const resolvedPath = dbFilePath || path.join(process.cwd(), 'kstreet_orders.sqlite');
    // Ensure parent dir exists if needed
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.initSchema();
  }

  private initSchema() {
    // Enable WAL mode & foreign keys
    this.db.exec(`PRAGMA journal_mode = WAL;`);
    this.db.exec(`PRAGMA foreign_keys = ON;`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stall_menu (
        id TEXT PRIMARY KEY,
        stallName TEXT NOT NULL,
        stallNameEn TEXT NOT NULL,
        stallLocation TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 1,
        itemsJson TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        publicOrderReference TEXT NOT NULL UNIQUE,
        idempotencyKey TEXT NOT NULL UNIQUE,
        visitorId TEXT NOT NULL,
        stallId TEXT NOT NULL,
        status TEXT NOT NULL,
        ownerAcknowledgement TEXT NOT NULL DEFAULT 'pending',
        ownerNote TEXT,
        subtotalKrw INTEGER NOT NULL,
        totalKrw INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        sentAt TEXT,
        acknowledgedAt TEXT,
        telegramMessageId INTEGER,
        telegramChatId TEXT,
        deliveryMode TEXT NOT NULL DEFAULT 'mock',
        deliveryError TEXT,
        originalTranscript TEXT,
        specialRequestEnglish TEXT,
        specialRequestKorean TEXT,
        formattedKorean TEXT,
        isMockDemo INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        orderId TEXT NOT NULL,
        menuItemId TEXT NOT NULL,
        koreanNameSnapshot TEXT NOT NULL,
        englishNameSnapshot TEXT NOT NULL,
        unitPriceKrwSnapshot INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        lineTotalKrw INTEGER NOT NULL,
        specialRequest TEXT,
        FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_orders_visitorId ON orders(visitorId);
      CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders(createdAt);
      CREATE INDEX IF NOT EXISTS idx_orders_ownerAcknowledgement ON orders(ownerAcknowledgement);
      CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId);
    `);

    // Seed menu if empty
    const menuRow = this.db.prepare('SELECT id FROM stall_menu WHERE id = ?').get('stall_001');
    if (!menuRow) {
      this.saveMenu(INITIAL_STALL_MENU);
    }
  }

  // --- Menu Operations ---
  public getMenu(): StallMenu {
    const row = this.db.prepare('SELECT * FROM stall_menu WHERE id = ?').get('stall_001') as any;
    if (row) {
      try {
        const items = JSON.parse(row.itemsJson);
        return {
          stallId: row.id,
          stallName: row.stallName,
          stallNameEn: row.stallNameEn,
          stallLocation: row.stallLocation,
          published: Boolean(row.published),
          items,
          updatedAt: row.updatedAt,
        };
      } catch (e) {
        console.warn('Failed parsing menu items JSON from DB, fallback to initial', e);
      }
    }
    return INITIAL_STALL_MENU;
  }

  public saveMenu(menu: StallMenu) {
    const stmt = this.db.prepare(`
      INSERT INTO stall_menu (id, stallName, stallNameEn, stallLocation, published, itemsJson, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        stallName=excluded.stallName,
        stallNameEn=excluded.stallNameEn,
        stallLocation=excluded.stallLocation,
        published=excluded.published,
        itemsJson=excluded.itemsJson,
        updatedAt=excluded.updatedAt
    `);
    stmt.run(
      menu.stallId || 'stall_001',
      menu.stallName,
      menu.stallNameEn,
      menu.stallLocation,
      menu.published ? 1 : 0,
      JSON.stringify(menu.items),
      menu.updatedAt || new Date().toISOString()
    );
  }

  // --- Order Operations ---

  public createOrder(params: {
    id: string;
    publicOrderReference: string;
    idempotencyKey: string;
    visitorId: string;
    stallId: string;
    items: OrderItem[];
    subtotalKrw: number;
    totalKrw: number;
    status: string;
    ownerAcknowledgement?: OwnerAcknowledgement;
    deliveryMode: 'live' | 'mock';
    deliverySuccess: boolean;
    telegramMessageId?: number;
    telegramChatId?: string;
    deliveryError?: string;
    originalTranscript?: string;
    specialRequestEnglish?: string;
    specialRequestKorean?: string;
    formattedKorean?: string;
    createdAt?: string;
    isMockDemo?: boolean;
  }): Order {
    const now = params.createdAt || new Date().toISOString();
    const isMockDemoNum = params.isMockDemo ? 1 : 0;

    const insertOrderStmt = this.db.prepare(`
      INSERT INTO orders (
        id, publicOrderReference, idempotencyKey, visitorId, stallId,
        status, ownerAcknowledgement, subtotalKrw, totalKrw,
        createdAt, sentAt, telegramMessageId, telegramChatId,
        deliveryMode, deliveryError, originalTranscript,
        specialRequestEnglish, specialRequestKorean, formattedKorean, isMockDemo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertOrderStmt.run(
      params.id,
      params.publicOrderReference,
      params.idempotencyKey,
      params.visitorId,
      params.stallId,
      params.status,
      params.ownerAcknowledgement || 'pending',
      params.subtotalKrw,
      params.totalKrw,
      now,
      params.deliverySuccess ? now : null,
      params.telegramMessageId ?? null,
      params.telegramChatId ?? null,
      params.deliveryMode,
      params.deliveryError ?? null,
      params.originalTranscript ?? null,
      params.specialRequestEnglish ?? null,
      params.specialRequestKorean ?? null,
      params.formattedKorean ?? null,
      isMockDemoNum
    );

    const insertItemStmt = this.db.prepare(`
      INSERT INTO order_items (
        id, orderId, menuItemId, koreanNameSnapshot, englishNameSnapshot,
        unitPriceKrwSnapshot, quantity, lineTotalKrw, specialRequest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < params.items.length; i++) {
      const item = params.items[i];
      const itemId = `${params.id}_item_${i + 1}`;
      const lineTotal = item.quantity * item.unitPriceKrw;
      insertItemStmt.run(
        itemId,
        params.id,
        item.menuItemId,
        item.koreanName,
        item.englishName,
        item.unitPriceKrw,
        item.quantity,
        lineTotal,
        item.specialRequest ?? null
      );
    }

    return this.mapToDomainOrder(params.id)!;
  }

  public saveOrder(params: Parameters<OrderDatabase['createOrder']>[0]): Order {
    return this.createOrder(params);
  }

  public getOrderByIdOrReference(idOrRef: string): Order | null {
    const row = this.db.prepare(`
      SELECT * FROM orders WHERE id = ? OR publicOrderReference = ?
    `).get(idOrRef, idOrRef) as any;
    if (!row) return null;
    return this.mapRowToDomainOrder(row);
  }

  public getOrderByIdempotencyKey(key: string): Order | null {
    const row = this.db.prepare('SELECT * FROM orders WHERE idempotencyKey = ?').get(key) as any;
    if (!row) return null;
    return this.mapRowToDomainOrder(row);
  }

  public updateOrderAcknowledgement(
    idOrRef: string,
    acknowledgement: OwnerAcknowledgement,
    note?: string,
    _telegramUserId?: number | string,
    force: boolean = false
  ): {
    success: boolean;
    order: Order | null;
    alreadyFinal: boolean;
    currentStatus: OwnerAcknowledgement;
  } {
    const order = this.getOrderByIdOrReference(idOrRef);
    if (!order) {
      return {
        success: false,
        order: null,
        alreadyFinal: false,
        currentStatus: 'pending',
      };
    }

    // Guard against repeated conflicting button presses on already final orders unless force is true
    if (!force && order.ownerAcknowledgement !== 'pending') {
      console.warn(`[DB] Conflict blocked: Order ${idOrRef} is already in final state: ${order.ownerAcknowledgement}`);
      return {
        success: false,
        order,
        alreadyFinal: true,
        currentStatus: order.ownerAcknowledgement,
      };
    }

    const now = new Date().toISOString();
    // Status mapping: if accepted, status becomes sent (fulfilled); if rejected -> failed; etc.
    let newStatus = order.status;
    if (acknowledgement === 'accepted') newStatus = 'sent';
    if (acknowledgement === 'rejected') newStatus = 'failed';

    const noteText = note !== undefined ? note : (order.ownerNote ?? null);

    this.db.prepare(`
      UPDATE orders SET
        ownerAcknowledgement = ?,
        ownerNote = ?,
        acknowledgedAt = ?,
        status = ?
      WHERE id = ?
    `).run(acknowledgement, noteText, now, newStatus, order.orderId);

    const updated = this.mapToDomainOrder(order.orderId);
    return {
      success: true,
      order: updated,
      alreadyFinal: false,
      currentStatus: acknowledgement,
    };
  }

  public updateTelegramMessageId(orderId: string, messageId: number, chatId: string) {
    this.db.prepare(`
      UPDATE orders SET telegramMessageId = ?, telegramChatId = ? WHERE id = ?
    `).run(messageId, chatId, orderId);
  }

  public getVisitorOrders(visitorId: string, filter?: 'today' | '7days' | '30days' | 'all'): Order[] {
    let sql = 'SELECT * FROM orders WHERE visitorId = ?';
    const params: any[] = [visitorId];

    if (filter === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      sql += ' AND createdAt >= ?';
      params.push(todayStart.toISOString());
    } else if (filter === '7days') {
      const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      sql += ' AND createdAt >= ?';
      params.push(past.toISOString());
    } else if (filter === '30days') {
      const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      sql += ' AND createdAt >= ?';
      params.push(past.toISOString());
    }

    sql += ' ORDER BY createdAt DESC LIMIT 100';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRowToDomainOrder(r));
  }

  public getOwnerOrders(options: {
    filter?: 'today' | '7days' | '30days' | 'all';
    status?: string;
    reference?: string;
    includeMock?: boolean;
    limit?: number;
    offset?: number;
  }): { orders: Order[]; totalCount: number } {
    const { filter = 'all', status, reference, includeMock = false, limit = 50, offset = 0 } = options;

    let whereClauses: string[] = [];
    const params: any[] = [];

    if (!includeMock) {
      whereClauses.push('isMockDemo = 0');
    }

    if (reference) {
      whereClauses.push('(publicOrderReference LIKE ? OR id LIKE ?)');
      params.push(`%${reference}%`, `%${reference}%`);
    }

    if (status && status !== 'all') {
      whereClauses.push('ownerAcknowledgement = ?');
      params.push(status);
    }

    if (filter === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      whereClauses.push('createdAt >= ?');
      params.push(todayStart.toISOString());
    } else if (filter === '7days') {
      const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      whereClauses.push('createdAt >= ?');
      params.push(past.toISOString());
    } else if (filter === '30days') {
      const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      whereClauses.push('createdAt >= ?');
      params.push(past.toISOString());
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM orders ${whereSql}`).get(...params) as any;
    const totalCount = countRow ? Number(countRow.cnt) : 0;

    const listSql = `
      SELECT * FROM orders
      ${whereSql}
      ORDER BY createdAt DESC
      LIMIT ? OFFSET ?
    `;
    const rows = this.db.prepare(listSql).all(...params, limit, offset) as any[];
    const orders = rows.map((r) => this.mapRowToDomainOrder(r));

    return { orders, totalCount };
  }

  /**
   * Deterministic calculations for visitor spending
   * Only counts accepted orders
   */
  public getVisitorSummary(visitorId: string): {
    totalSpentKrw: number;
    totalOrdersCount: number;
    acceptedOrdersCount: number;
    pendingOrdersCount: number;
    latestOrder: Order | null;
  } {
    const orders = this.getVisitorOrders(visitorId, 'all');
    let totalSpentKrw = 0;
    let acceptedOrdersCount = 0;
    let pendingOrdersCount = 0;

    for (const ord of orders) {
      if (ord.ownerAcknowledgement === 'accepted') {
        totalSpentKrw += ord.totalKrw;
        acceptedOrdersCount++;
      } else if (ord.ownerAcknowledgement === 'pending') {
        pendingOrdersCount++;
      }
    }

    return {
      totalSpentKrw,
      totalOrdersCount: orders.length,
      acceptedOrdersCount,
      pendingOrdersCount,
      latestOrder: orders.length > 0 ? orders[0] : null,
    };
  }

  /**
   * Deterministic revenue and order metric calculations for stall owner
   * Only orders acknowledged as 'accepted' count toward revenue
   * Mock/demo orders are excluded by default
   */
  public getOwnerSummary(includeMock = false): {
    acceptedOrdersToday: number;
    pendingOrdersCount: number;
    rejectedOrdersCount: number;
    revenueTodayKrw: number;
    revenue7DaysKrw: number;
    revenue30DaysKrw: number;
    allTimeRevenueKrw: number;
    totalOrdersCount: number;
  } {
    const mockFilter = includeMock ? '' : 'AND isMockDemo = 0';

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Accepted today
    const acceptedTodayRow = this.db.prepare(`
      SELECT COUNT(*) as count, SUM(totalKrw) as revenue
      FROM orders
      WHERE ownerAcknowledgement = 'accepted'
        AND createdAt >= ?
        ${mockFilter}
    `).get(todayStart) as any;

    // 7 days revenue
    const rev7Row = this.db.prepare(`
      SELECT SUM(totalKrw) as revenue
      FROM orders
      WHERE ownerAcknowledgement = 'accepted'
        AND createdAt >= ?
        ${mockFilter}
    `).get(sevenDaysAgo) as any;

    // 30 days revenue
    const rev30Row = this.db.prepare(`
      SELECT SUM(totalKrw) as revenue
      FROM orders
      WHERE ownerAcknowledgement = 'accepted'
        AND createdAt >= ?
        ${mockFilter}
    `).get(thirtyDaysAgo) as any;

    // All time revenue & counts
    const allTimeRow = this.db.prepare(`
      SELECT
        COUNT(*) as totalOrders,
        SUM(CASE WHEN ownerAcknowledgement = 'accepted' THEN totalKrw ELSE 0 END) as allTimeRevenue,
        SUM(CASE WHEN ownerAcknowledgement = 'pending' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN ownerAcknowledgement = 'rejected' THEN 1 ELSE 0 END) as rejectedCount
      FROM orders
      WHERE 1=1 ${mockFilter}
    `).get() as any;

    return {
      acceptedOrdersToday: Number(acceptedTodayRow?.count || 0),
      pendingOrdersCount: Number(allTimeRow?.pendingCount || 0),
      rejectedOrdersCount: Number(allTimeRow?.rejectedCount || 0),
      revenueTodayKrw: Number(acceptedTodayRow?.revenue || 0),
      revenue7DaysKrw: Number(rev7Row?.revenue || 0),
      revenue30DaysKrw: Number(rev30Row?.revenue || 0),
      allTimeRevenueKrw: Number(allTimeRow?.allTimeRevenue || 0),
      totalOrdersCount: Number(allTimeRow?.totalOrders || 0),
    };
  }

  // --- Internal Mappers ---
  private mapToDomainOrder(orderId: string): Order | null {
    const row = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
    if (!row) return null;
    return this.mapRowToDomainOrder(row);
  }

  private mapRowToDomainOrder(row: any): Order {
    const itemsRows = this.db.prepare(`
      SELECT * FROM order_items WHERE orderId = ? ORDER BY id ASC
    `).all(row.id) as any[];

    const items: OrderItem[] = itemsRows.map((ir) => ({
      menuItemId: ir.menuItemId,
      koreanName: ir.koreanNameSnapshot,
      englishName: ir.englishNameSnapshot,
      unitPriceKrw: Number(ir.unitPriceKrwSnapshot),
      quantity: Number(ir.quantity),
      specialRequest: ir.specialRequest || undefined,
    }));

    return {
      orderId: row.id,
      publicOrderReference: row.publicOrderReference,
      idempotencyKey: row.idempotencyKey,
      visitorId: row.visitorId,
      stallId: row.stallId,
      items,
      subtotalKrw: Number(row.subtotalKrw),
      totalKrw: Number(row.totalKrw),
      originalTranscript: row.originalTranscript || undefined,
      koreanTranslation: {
        formattedKorean: row.formattedKorean || '',
        specialRequestsKorean: row.specialRequestKorean || undefined,
      },
      status: row.status as any,
      ownerAcknowledgement: row.ownerAcknowledgement as OwnerAcknowledgement,
      ownerNote: row.ownerNote || undefined,
      createdAt: row.createdAt,
      sentAt: row.sentAt || undefined,
      acknowledgedAt: row.acknowledgedAt || undefined,
      isMockDemo: Boolean(row.isMockDemo),
      telegramDelivery: {
        attempted: true,
        success: Boolean(row.status === 'sent' || row.ownerAcknowledgement !== 'pending'),
        mode: row.deliveryMode as 'live' | 'mock',
        messageId: row.telegramMessageId ? Number(row.telegramMessageId) : undefined,
        error: row.deliveryError || undefined,
        timestamp: row.sentAt || row.createdAt,
      },
    };
  }
}

// Singleton database instance
export const orderDb = new OrderDatabase();
