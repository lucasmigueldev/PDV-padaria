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

O React Compiler permanece desabilitado nesta configuração. A aplicação usa armazenamento local do navegador para os dados operacionais atuais.

## Estrutura do projeto

```text
src/
├── assets/                 # Imagens e arquivos visuais
├── components/             # Componentes reutilizáveis
├── data/                   # Acesso e persistência local de produtos, vendas e caixas
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

As páginas concentram as experiências de cada área, enquanto `src/data` mantém as responsabilidades de leitura e persistência local. Os tipos compartilhados ficam em `src/types`, reduzindo contratos duplicados entre as telas.

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
- Avaliar a migração gradual da persistência local para uma arquitetura compartilhada.

### Futuro

- Backend e banco de dados;
- Autenticação real, múltiplos usuários e permissões;
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
