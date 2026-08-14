import { mkdir, writeFile } from 'node:fs/promises'

const fixtures = new Map([
  [
    'tiny.png',
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWMQybvzHx9mGBkKAJyrl0HDp93DAAAAAElFTkSuQmCC',
  ],
  [
    'tiny.jpg',
    '/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAACP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJUAXY3v/9k=',
  ],
  ['tiny.webp', 'UklGRj4AAABXRUJQVlA4IDIAAAAwAgCdASoIAAgAAMASJaACdLoB+AH6AARoAAD+9IiH/1dnCvnw/6u2/+K1h1nF/4nEAA=='],
  ['tiny.gif', 'R0lGODlhCAAIAIAAAExpcRRu3CH5BAUAAAAALAAAAAAIAAgAAAIHjI+py+1dAAA7'],
])

const directory = new URL('../fixtures/', import.meta.url)
await mkdir(directory, { recursive: true })
for (const [name, base64] of fixtures) await writeFile(new URL(name, directory), Buffer.from(base64, 'base64'))
await writeFile(new URL('invalid.bin', directory), Buffer.from('not an image\n', 'utf8'))
