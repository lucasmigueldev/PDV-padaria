# Padaria PDV

Sistema de ponto de venda para padarias, desenvolvido para organizar produtos, vendas e a rotina de caixa em uma interface única.

## Sobre o projeto

O Padaria PDV busca simplificar a operação diária de uma padaria: cadastrar produtos, controlar estoque, registrar vendas e conferir o caixa ao final da sessão.

O projeto está sendo construído de forma incremental. Cada funcionalidade é implementada, testada e aprovada individualmente, preservando o que já está funcionando e mantendo espaço para uma evolução gradual do produto.

## Funcionalidades

Funcionalidades confirmadas no estado atual:

- Login e navegação protegida das áreas administrativas;
- Dashboard com visão geral da operação;
- Cadastro, edição e exclusão de produtos;
- Código de barras para identificação de produtos;
- Controle de estoque e validações de disponibilidade;
- PDV com inclusão de produtos por código de barras;
- Finalização de vendas;
- Pagamentos em dinheiro, PIX e cartão;
- Cálculo de troco para pagamentos em dinheiro;
- Histórico de vendas com busca, filtros, ordenação e paginação;
- Comprovante não fiscal de 58 mm, visualização, impressão e reimpressão pelo histórico;
- Exportação do histórico de vendas em PDF;
- Abertura de caixa com valor inicial e data/hora automáticas;
- Movimentação em dinheiro do caixa aberto;
- Valor esperado, valor contado e diferença da conferência;
- Fechamento definitivo do caixa;
- Histórico de caixas fechados;
- Visualização dos detalhes de um fechamento;
- Filtro por data de fechamento.

## Tecnologias

- React 19;
- TypeScript;
- Vite;
- React Router;
- Tailwind CSS;
- Lucide React para ícones;
- jsPDF para exportação do histórico de vendas;
- ESLint para análise de qualidade do código.

O React Compiler permanece desabilitado nesta configuração. Os dados do negócio são lidos e persistidos pelo Supabase; a sessão de autenticação é gerenciada pelo SDK Supabase.

A preferência de impressão do comprovante (automática, manual ou desativada) é salva no Supabase e vinculada ao usuário autenticado. A migration `20261014120000_user_receipt_preferences.sql` cria a tabela e suas políticas RLS; ela ainda precisa ser aplicada no Supabase para habilitar a persistência remota. Enquanto a consulta inicial está pendente, o PDV não inicia a impressão automática. Se a consulta falhar, o operador recebe um erro e pode tentar novamente; a venda confirmada continua sem ser revertida. A impressão utiliza o diálogo do navegador e não confirma se o papel foi efetivamente impresso.

Na conclusão de uma venda, a RPC retorna somente o identificador e o perfil operador não pode consultar a linha da venda pelas permissões atuais. Por isso, o comprovante imediato usa o resumo enviado pelo PDV e o identificador confirmado pela RPC; em caso de alteração concorrente de preço, os valores do resumo podem divergir dos valores persistidos. A reimpressão do histórico usa os dados persistidos disponíveis para o perfil autorizado. O nome da padaria no histórico é o nome atual, pois não há snapshot do nome associado à venda.

## Estrutura do projeto

```text
src/
├── assets/                 # Imagens e arquivos visuais
├── components/             # Componentes reutilizáveis
├── data/                   # Consultas e mapeamento de dados do Supabase
├── services/               # Operações Supabase e RPCs do domínio
├── pages/                  # Telas da aplicação
│   ├── Dashboard/
│   ├── Fechamento/
│   ├── HistoricoFechamentos/
│   ├── HistoricoVendas/
│   ├── Login/
│   ├── PDV/
│   └── Produtos/
├── types/                  # Tipos de domínio
├── App.tsx                 # Rotas e proteção de acesso
└── main.tsx                # Ponto de entrada da aplicação
```

As páginas concentram as experiências de cada área, enquanto `src/data` e `src/services` consultam e persistem dados de negócio no Supabase. Os tipos compartilhados ficam em `src/types`, reduzindo contratos duplicados entre as telas.

## Como executar

Pré-requisitos: Node.js e npm instalados.

```bash
npm install
npm run dev
```

Comandos disponíveis:

```bash
npm run lint       # Executa o ESLint
npm run build      # Executa o TypeScript e gera o build de produção
npm run preview    # Publica localmente o build gerado
```

### Teste do PDV offline

No desenvolvimento, `npm run dev` registra um Service Worker separado, que mantém em cache apenas os módulos e recursos da própria origem. Ele consulta a rede primeiro para manter o HMR e a versão atual do servidor; se a rede falhar, pode servir os recursos já carregados online e o shell da aplicação para recargas com `F5`. Nenhuma API, chamada ao Supabase ou dado de negócio é armazenado por esse worker. A primeira abertura deve ser online; módulos de rotas e recursos carregados sob demanda precisam ser visitados online antes de ficarem disponíveis offline.

Para validar o comportamento do build de produção (arquivos finais com hash e pré-cache integral), gere e sirva o build:

```bash
npm run build
npm run preview
```

No Firefox, abra o endereço do dev ou preview, faça login e aguarde o Service Worker ficar ativo. Com a conexão disponível, abra o caixa e carregue o catálogo; em seguida, coloque o navegador em modo offline e teste uma venda e o `F5`. A recuperação exige a mesma aba do navegador, uma sessão Supabase ainda válida, catálogo local e confirmação de caixa aberto dentro da janela de segurança de 12 horas. Operadores recuperados offline ficam restritos ao PDV. Ao reconectar, as vendas pendentes são sincronizadas; os dados locais não são apagados pelo reload.

### Histórico de caixas fora do ar

A migration `20261020110000_create_pdv_offline_episodes.sql` adiciona a tabela de ocorrências e RPCs administrativas; não altera `pdv_heartbeats` nem configura `pg_cron`. O histórico usa o ID real do caixa, impede ocorrências abertas duplicadas e só permite gravação/encerramento por administradores autorizados.

Antes de publicar a versão que usa o ciclo de sessão, aplique também a migration incremental `20261031202500_add_pdv_cash_register_session_lifecycle.sql`. Ela persiste, por caixa, encerramentos autenticados por logout ou sinalização `pagehide`, permite restaurar a mesma sessão após reload/F5 e exclui sessões encerradas do monitor atual. O servidor valida operador, padaria, caixa aberto e autenticação; episódios encerrados normalmente são mantidos como `session_ended` e não entram no histórico.

O monitor administrativo registra uma ocorrência após detectar mais de 75 segundos sem heartbeat de uma sessão sem sinalização de encerramento. A lista atual descreve precisamente esse estado como "sem heartbeat recente"; não prova que o operador perdeu a internet. O encerramento normal pelo botão Sair envia a RPC enquanto a página está ativa. O sinal no fechamento do navegador usa `pagehide` e `fetch` com `keepalive`, mas é best-effort: o Firefox pode encerrar o processo ou a rede antes da conclusão, sem garantir que o evento ou a requisição chegue ao servidor. Não é possível distinguir perfeitamente o fechamento abrupto de uma perda de conexão. F5 é revertido na restauração da sessão. Uma ocorrência só aparece no histórico quando uma consulta confirma heartbeat recente do mesmo operador, padaria e caixa, ou quando confirma que o caixa foi fechado; episódios em andamento e sessões encerradas normalmente não são exibidos como histórico concluído. Falhas de consulta e desaparecimentos temporários não encerram ocorrências. O registro depende do polling desta página: ocorrências podem não ser capturadas enquanto o monitor administrativo estiver fechado. O histórico não é criado retroativamente e a contagem de vendas offline permanece indisponível.

## Demonstração

Espaço reservado para futura inclusão de:

- link da aplicação publicada;
- screenshots das principais telas;
- GIFs ou vídeos dos fluxos de venda e fechamento.

Nenhum link de demonstração está definido neste momento.

## Roadmap

### Concluído

- Fluxo de login e navegação administrativa;
- Cadastro de produtos e controle de estoque;
- Operação de vendas no PDV;
- Histórico e exportação de vendas;
- Abertura, conferência e fechamento de caixa;
- Histórico de fechamentos com detalhes e filtro por data.

### Próximos passos

- Evoluir os fluxos administrativos conforme as necessidades do produto;
- Consolidar regras de operação e documentação para novos colaboradores;
- Aplicar, com autorização, as migrations operacionais pendentes e validar a integração com o Supabase.

### Futuro

- Edição e exclusão administrativas de usuários;
- Persistência em nuvem, sincronização, backups e auditoria;
- Suporte a múltiplas empresas.

Os itens de próximos passos e futuro são direcionadores de evolução, não funcionalidades disponíveis atualmente.

## Desenvolvimento

O projeto é desenvolvido de forma incremental. Cada funcionalidade deve ser implementada em escopo controlado, validada com lint e build, testada no fluxo correspondente e aprovada antes de avançar para a próxima etapa.

## Contribuição

Futuramente, outros desenvolvedores poderão contribuir com o projeto. As regras detalhadas de contribuição serão documentadas em `CONTRIBUTING.md` quando esse processo for formalizado.

## Git

- Usar Conventional Commits;
- Criar um commit para cada funcionalidade lógica independente;
- Testar antes de criar o commit;
- Evitar misturar funcionalidades diferentes no mesmo commit;
- Realizar push somente após validação e autorização do responsável.

## Licença

O projeto ainda não possui uma licença definida.

## Status

Em desenvolvimento.
