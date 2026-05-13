// ============================================================
// IndexedDB wrapper for scraped data persistence
//
// chrome.storage.local: config, task state (small data)
// IndexedDB: scraped data rows (potentially large)
// ============================================================

import { DB_CONFIG, type ScrapedRow } from '@/shared/types'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.NAME, DB_CONFIG.VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const oldVersion = event.oldVersion

      // v1 → v2: add indices for taskId and hash
      if (oldVersion < 2) {
        // Ensure store exists (v1 base)
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SCRAPED_DATA)) {
          const store = db.createObjectStore(DB_CONFIG.STORES.SCRAPED_DATA, { keyPath: 'id' })
          store.createIndex('taskId', 'taskId', { unique: false })
          store.createIndex('hash', 'hash', { unique: false })
        } else {
          // Store exists from v1, add missing indices
          const tx = (event.target as IDBOpenDBRequest).transaction!
          const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_DATA)
          if (!store.indexNames.contains('taskId')) {
            store.createIndex('taskId', 'taskId', { unique: false })
          }
          if (!store.indexNames.contains('hash')) {
            store.createIndex('hash', 'hash', { unique: false })
          }
        }
      }

      // Initial creation (fresh install)
      if (oldVersion === 0) {
        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SCRAPED_DATA)) {
          const store = db.createObjectStore(DB_CONFIG.STORES.SCRAPED_DATA, { keyPath: 'id' })
          store.createIndex('taskId', 'taskId', { unique: false })
          store.createIndex('hash', 'hash', { unique: false })
        }
      }

      if (!db.objectStoreNames.contains(DB_CONFIG.STORES.TEMPLATES)) {
        db.createObjectStore(DB_CONFIG.STORES.TEMPLATES, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function storeScrapedData(rows: ScrapedRow[]): Promise<{ stored: number; skipped: number }> {
  const db = await openDB()
  const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_DATA, 'readwrite')
  const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_DATA)
  const hashIndex = store.index('hash')

  let storedCount = 0
  let skippedCount = 0

  // Use index-based hash lookup instead of loading all data into memory
  for (const row of rows) {
    const exists = await new Promise<boolean>((resolve, reject) => {
      const req = hashIndex.count(IDBKeyRange.only(row.hash))
      req.onsuccess = () => resolve(req.result > 0)
      req.onerror = () => reject(req.error)
    })

    if (exists) {
      skippedCount++
      continue
    }
    store.put(row)
    storedCount++
  }

  return new Promise<{ stored: number; skipped: number }>((resolve, reject) => {
    tx.oncomplete = () => resolve({ stored: storedCount, skipped: skippedCount })
    tx.onerror = () => reject(tx.error)
  })
}

export async function getScrapedData(
  taskId: string,
  limit = 100,
  offset = 0
): Promise<ScrapedRow[]> {
  const db = await openDB()
  const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_DATA, 'readonly')
  const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_DATA)
  const taskIndex = store.index('taskId')

  return new Promise((resolve, reject) => {
    const results: ScrapedRow[] = []
    let cursorSkipped = 0
    const range = IDBKeyRange.only(taskId)
    const cursorReq = taskIndex.openCursor(range)
    
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (cursor) {
        if (cursorSkipped < offset) {
          cursorSkipped++
        } else if (results.length < limit) {
          results.push(cursor.value)
        }
        // Only continue if we haven't reached limit
        if (results.length < limit) {
          cursor.continue()
        } else {
          resolve(results)
        }
      } else {
        resolve(results)
      }
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
}

export async function countScrapedData(): Promise<number> {
  const db = await openDB()
  const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_DATA, 'readonly')
  const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_DATA)

  return new Promise((resolve, reject) => {
    const request = store.count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function clearScrapedData(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_DATA, 'readwrite')
  const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_DATA)
  store.clear()

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function exportToCsv(taskId: string): Promise<string> {
  const rows = await getScrapedData(taskId, 100000)

  if (rows.length === 0) return ''

  const headers = Object.keys(rows[0].data)
  const csvRows = [headers.join(',')]

  for (const row of rows) {
    const values = headers.map((h) => {
      const val = (row.data[h] ?? '').toString()
      // Escape double-quotes by doubling them (RFC 4180)
      const escaped = val.replace(/"/g, '""')
      // Quote fields containing commas, double-quotes, or newlines
      if (/[",\n\r]/.test(val)) {
        return `"${escaped}"`
      }
      return escaped
    })
    csvRows.push(values.join(','))
  }

  return csvRows.join('\n')
}
