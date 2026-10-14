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
