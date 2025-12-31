# Command Database MCP Server

Servidor MCP para búsqueda semántica de comandos Checkpoint.

## Instalación
```bash
npm install
```

## Configuración inicial

Inicializar la base de datos con datos de ejemplo:
```bash
sqlite3 commands.db < init-data.sql
```

## Uso
```bash
node server.js
```
