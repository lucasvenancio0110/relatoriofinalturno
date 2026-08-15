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
- `src/js/dialog-layout.js`: cálculo puro da área visível e do teclado móvel.
- `src/js/responsive-dialogs.js`: abertura, fechamento e animação responsiva dos popups.
- `src/js/app.js`: interface, acessibilidade e orquestração dos fluxos.
- `scripts/build.mjs`: bundle de produção com esbuild e dependências npm incorporadas.
- `tests/`: testes do parser, domínio, relatório, nuvem e estrutura estática.

## Ronda e manutenção rápida

As decisões de cada máquina seguem o fluxo do `passagemdeturno`: `VAI PASSAR EM AJUSTE`,
`VAI PASSAR EM SETUP`, `VAI PASSAR EM MANUTENÇÃO`, `LIBERADA` e `REMOVER DO RELATÓRIO`.
Setup, ajuste e manutenção são resolvidos categoria por categoria, sem apagar silenciosamente
uma informação quando existe conflito.

Ao escolher manutenção, o app abre até quatro blocos progressivos:

1. situação da máquina — `EM MANUTENÇÃO` ou `LIBERADA`;
2. origem da parada e chamado Tractian, como `#6661`;
3. chegada da manutenção e horário, quando houve atuação;
4. horário da liberação, somente quando a máquina foi liberada.

A origem pode ser do turno anterior, do turno atual ou uma intervenção iniciada diretamente
pela manutenção, como em preventivas. Se o preparador já marcou a conclusão com `✅`, a situação
vem confirmada como liberada e o operador registra apenas origem, chamado e horários.

Cada toque e cada digitação salva automaticamente no `localStorage` do navegador. Trocar para o
Tractian, fechar o app, recarregar a página ou voltar em outro dia no mesmo dispositivo restaura
a TNL e o ponto exato do formulário, sem botão de checkpoint. O rascunho só é removido após a
confirmação final ou quando o usuário limpa explicitamente a sessão.

No relatório final, as listas operacionais permanecem compactas. O detalhamento do chamado
Tractian, da atuação e do resultado aparece sem emojis, agrupado por máquina entre
`DESENVOLVIMENTO` e `OBSERVAÇÕES`.

## Popups responsivos

Os diálogos continuam usando o elemento nativo `<dialog>` para preservar foco, teclado, `ESC` e
o retorno dos formulários. O pacote npm `motion` é incorporado ao bundle somente pela entrada
`motion/mini`, enquanto `VisualViewport` mantém os cards acima do teclado no iPhone e no Android.
Container queries reorganizam os botões apenas quando o espaço interno realmente fica estreito;
em celular comum, as respostas rápidas permanecem lado a lado.

## Validação local

```bash
npm install
npm run validate
```

O pipeline executa a mesma validação em pull requests. O deploy para GitHub Pages só ocorre em `main` depois que os testes ficam verdes.
