# Relatório Final de Turno

Aplicação modular para preparar, revisar e copiar a passagem final de turno das células CNC.

## Estrutura

- `index.html`: estrutura semântica das três etapas — Dados, Ronda e Relatório.
- `styles/`: tokens, base, componentes e responsividade.
- `src/js/config.js`: configurações, células e categorias.
- `src/js/parser.js`: leitura do relatório bruto e de Desenvolvimento/Observações.
- `src/js/maintenance.js`: ciclo do chamado, horários, atuação e condição final da máquina.
- `src/js/model.js`: estado, conflitos, ledger de progresso, decisões, desfazer e reedição.
- `src/js/report.js`: geração da mensagem final para WhatsApp.
- `src/js/cloud.js`: histórico em nuvem e fila offline.
- `src/js/app.js`: interface, acessibilidade e orquestração dos fluxos.
- `tests/`: testes do parser, domínio, relatório, nuvem e estrutura estática.

## Acompanhamento de manutenção

Toda TNL citada em manutenção entra na ronda, inclusive quando chega marcada com `✅` ou no
bloco de manutenções concluídas. O fluxo registra o turno que abriu o chamado, os horários
condicionais de abertura/chegada/término e uma das situações finais: liberada, em
acompanhamento, continua parada, passou para ajuste ou passou para setup. As atualizações
permanecem vinculadas à TNL e podem ser refeitas sem perder a linha do tempo já registrada.

## Validação local

```bash
npm install
npm run validate
```

O pipeline executa a mesma validação em pull requests. O deploy para GitHub Pages só ocorre em `main` depois que os testes ficam verdes.
