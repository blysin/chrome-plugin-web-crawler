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

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SCRAPED_DATA)) {
        db.createObjectStore(DB_CONFIG.STORES.SCRAPED_DATA, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(DB_CONFIG.STORES.TEMPLATES)) {
        db.createObjectStore(DB_CONFIG.STORES.TEMPLATES, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function storeScrapedData(rows: ScrapedRow[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(DB_CONFIG.STORES.SCRAPED_DATA, 'readwrite')
  const store = tx.objectStore(DB_CONFIG.STORES.SCRAPED_DATA)

  for (const row of rows) {
    store.put(row)
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
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

  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => {
      const all = request.result as ScrapedRow[]
      resolve(all.slice(offset, offset + limit))
    }
    request.onerror = () => reject(request.error)
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
      const val = row.data[h] ?? ''
      return `"${val.replace(/"/g, '""')}"`
    })
    csvRows.push(values.join(','))
  }

  return csvRows.join('\n')
}
