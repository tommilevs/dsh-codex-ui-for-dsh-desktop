import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const source = readFileSync(new URL('../src/client/CodexSettingsPage.tsx', import.meta.url), 'utf8')
assert.match(source, /document\.getElementById\('root'\)\s*\?\?\s*document\.body/,
  'Settings must remain within the Desktop renderer watchdog root')
const stylesSource = readFileSync(new URL('../src/client/settings-page-styles.ts', import.meta.url), 'utf8')
const styles = stylesSource.slice(stylesSource.indexOf('`') + 1, stylesSource.lastIndexOf('`'))
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const page = await browser.newPage()
  await page.setContent(`<style>${styles}</style><div id="root" inert data-dcu-settings-isolated><div class="dcu-root" style="transform:translateX(0);width:56px"><button id="session">Session</button></div></div><div class="dcu-settings-page"><button>Back to app</button></div>`)
  // Desktop 2.0.17's meaningful-visible-content test (without visibilityState,
  // since this isolated browser fixture also runs headlessly).
  const probe = () => {
    const roots = [...document.querySelectorAll('[data-desktop-onboarding-surface]'), document.getElementById('root')].filter(Boolean)
    let visited = 0
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
      let element = walker.currentNode
      while (element && visited < 2048) {
        visited++
        const meaningful = element.matches('button,input,textarea,select,img,svg,canvas,[contenteditable="true"]')
          || [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        if (meaningful && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
          const rect = element.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth) return true
        }
        element = walker.nextNode()
      }
      if (element) return null
    }
    return false
  }
  await page.locator('.dcu-settings-page').evaluate(node => { node.style.animation = 'none' })
  assert.equal(await page.locator('.dcu-settings-page').isVisible(), true)
  assert.equal(await page.evaluate(probe), false, 'Old body portal reproduces the false blank-page report')
  await page.evaluate(() => {
    const root = document.getElementById('root')
    root.append(document.querySelector('.dcu-settings-page'))
    root.inert = false
    root.removeAttribute('data-dcu-settings-isolated')
    const app = root.querySelector('.dcu-root')
    app.inert = true
    app.setAttribute('data-dcu-settings-isolated', '')
  })
  assert.equal(await page.evaluate(probe), true)
  assert.equal(await page.locator('#session').isVisible(), false)
  assert.equal(await page.locator('.dcu-settings-page').evaluate(node => node.getBoundingClientRect().width), await page.evaluate(() => innerWidth), 'Transformed sidebar must not constrain Settings')
  await page.evaluate(() => {
    document.querySelector('.dcu-settings-page').remove()
    const app = document.querySelector('.dcu-root')
    app.inert = false
    app.removeAttribute('data-dcu-settings-isolated')
  })
  assert.equal(await page.locator('#session').isVisible(), true)
  assert.equal(await page.evaluate(probe), true)
  console.log('Desktop watchdog portal, background isolation and exit restoration passed')
} finally { await browser.close() }
