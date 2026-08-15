# Relatório Final de Turno

Aplicação modular para preparar, revisar e copiar a passagem final de turno das células CNC.

## Estrutura

- `index.html`: estrutura semântica das três etapas — Dados, Ronda e Relatório.
- `styles/`: tokens, base, componentes e responsividade.
- `src/js/config.js`: configurações, células e categorias.
- `src/js/parser.js`: leitura do relatório bruto e de Desenvolvimento/Observações.
- `src/js/maintenance.js`: ciclo do chamado, horários, atuação e condição final da máquina.
- `src/js/transitions.js`: sequência entre setup e manutenção sem apagar etapas anteriores.
- `src/js/model.js`: estado, conflitos, ledger de progresso, decisões, desfazer e reedição.
- `src/js/report.js`: geração da mensagem final para WhatsApp.
- `src/js/cloud.js`: histórico em nuvem e fila offline.
- `src/js/app.js`: interface, acessibilidade e orquestração dos fluxos.
- `tests/`: testes do parser, domínio, relatório, nuvem e estrutura estática.

## Acompanhamento de manutenção

Toda TNL citada em manutenção entra na ronda, inclusive quando chega marcada com `✅` ou no
bloco de manutenções concluídas. A Ronda Expressa usa botões grandes para registrar se a
produção abriu o chamado ou se a manutenção iniciou diretamente, o código Tractian (por
exemplo, `#6661`), o turno e o horário de cada etapa e uma das situações finais: liberada, em
acompanhamento, continua parada, passou para ajuste ou passou para setup.

Quando a manutenção já chega marcada como concluída pelo preparador, a ronda não pergunta
novamente se houve liberação: registra somente a origem, o chamado e os horários de início e
liberação. Se ela ainda estiver aberta, o fluxo diferencia manutenção não iniciada, atendimento
em andamento e liberação.

Nos conflitos de setup com manutenção, o sistema preserva a ordem dos eventos. Depois de
registrar a manutenção, é possível informar que o setup terminou antes da manutenção, que foi
interrompido e deve ser retomado depois ou que a informação de setup estava incorreta.

O formulário mantém rascunhos automaticamente no dispositivo a cada alteração e também ao
ocultar, fechar ou recarregar a página. Ao voltar no mesmo navegador, a TNL e o formulário em
andamento são restaurados sem exigir um botão de checkpoint. A confirmação final remove o
rascunho e registra a decisão. Limpar os dados do site no navegador também remove esses
rascunhos locais.

No relatório final, as listas operacionais permanecem compactas. O detalhamento de origem,
chamado Tractian, atuação e resultado aparece sem emojis, agrupado por máquina entre
`DESENVOLVIMENTO` e `OBSERVAÇÕES`.

## Validação local

```bash
npm install
npm run validate
```

O pipeline executa a mesma validação em pull requests. O deploy para GitHub Pages só ocorre em `main` depois que os testes ficam verdes.
