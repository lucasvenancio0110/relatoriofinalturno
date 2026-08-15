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
bloco de manutenções concluídas. Ao tocar na máquina, a primeira decisão obrigatória é o próximo
passo: `VAI PASSAR EM MANUTENÇÃO` ou `VAI PASSAR EM SETUP`. O atendimento do chamado só abre
depois dessa definição e nada é retirado do relatório antes da confirmação final.

No caminho de manutenção, o app abre diretamente os dados do atendimento. No caminho de setup,
primeiro pergunta se a máquina está `EM SETUP` ou se deve `INICIAR SETUP`; em seguida pergunta se
a manutenção foi concluída. Tanto `SIM` quanto `NÃO` levam ao atendimento do chamado. A ronda
rápida abre no máximo quatro blocos, um por vez: chegada da manutenção, liberação, chamado
Tractian (por exemplo, `#6661`) e situação atual da máquina — liberada/produzindo ou parada.

Quando a manutenção já chega marcada como concluída pelo preparador, a ronda não pergunta
novamente se ela chegou ou liberou: pede somente os horários, o chamado e como a máquina está.
Nos demais casos, opções rápidas como `AINDA NÃO CHEGOU`, `JÁ ESTAVA NO INÍCIO DO TURNO`,
`CHEGOU AGORA` e `AINDA ESTÁ EM MANUTENÇÃO` substituem os campos de origem e turno.

Nos conflitos de setup com manutenção, a escolha inicial define a ordem dos eventos. Ao seguir
para manutenção, o setup anterior é concluído antes da manutenção. Ao seguir para setup, a
situação escolhida do setup é mantida junto do registro do atendimento, inclusive quando a
manutenção ainda não terminou.

O formulário mantém rascunhos automaticamente no dispositivo a cada alteração e também ao
ocultar, fechar ou recarregar a página. Ao voltar no mesmo navegador, a TNL e o formulário em
andamento são restaurados sem exigir um botão de checkpoint. O rascunho inclui o destino
manutenção/setup, a situação escolhida do setup e a resposta sobre a conclusão da manutenção.
A confirmação final remove o
rascunho e registra a decisão. Limpar os dados do site no navegador também remove esses
rascunhos locais.

No relatório final, as listas operacionais permanecem compactas. O detalhamento do chamado
Tractian, da atuação e do resultado aparece sem emojis, agrupado por máquina entre
`DESENVOLVIMENTO` e `OBSERVAÇÕES`.

## Validação local

```bash
npm install
npm run validate
```

O pipeline executa a mesma validação em pull requests. O deploy para GitHub Pages só ocorre em `main` depois que os testes ficam verdes.
