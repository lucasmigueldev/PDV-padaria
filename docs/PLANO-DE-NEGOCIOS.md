# Plano de Negócios e Referência de Produto — Padaria PDV

Este documento é a referência oficial de produto e arquitetura de negócio do Padaria PDV. Ele registra o que existe hoje, a visão comercial do produto e as regras que devem orientar a evolução futura.

Funcionalidades, usuários, vendas, caixa, estoque, relatórios, unidades e permissões devem ser planejados de acordo com este documento. As definições futuras aqui descritas não representam funcionalidades implementadas.

## 1. Visão do produto

O Padaria PDV é um sistema de gestão e ponto de venda desenvolvido inicialmente para uma padaria, com objetivo de ser comercializado para pequenos estabelecimentos. A solução reúne venda no PDV, produtos, estoque, caixa, fechamentos, histórico de vendas, relatórios e configurações administrativas.

O produto deve ser simples para quem opera o caixa e completo para o proprietário acompanhar o negócio. A primeira expansão considerada é atender um proprietário que possui duas padarias, preservando uma arquitetura capaz de suportar outras unidades no futuro.

## 2. Problema e proposta de valor

Pequenas operações podem ter dificuldade para manter vendas, produtos, estoque e caixa organizados em ferramentas separadas ou processos manuais. O Padaria PDV busca reduzir essa fragmentação e oferecer:

- operação de venda objetiva;
- cadastro e consulta de produtos;
- controle de estoque;
- pagamentos em dinheiro, PIX e cartão;
- abertura, movimentação e fechamento de caixa;
- histórico operacional consultável;
- relatórios adequados ao nível de acesso do usuário;
- visão consolidada ou filtrada por unidade para o proprietário, no futuro.

## 3. Público-alvo e modelo de negócio

O público-alvo inicial é composto por:

- proprietários de pequenas padarias e outros pequenos estabelecimentos;
- operadores de caixa e funcionários responsáveis pelas vendas;
- responsáveis pela conferência e fechamento do caixa;
- gestores que precisam acompanhar vendas, produtos e estoque.

O modelo comercial ainda não está definido. São hipóteses para investigação futura, sem decisão de preço ou formato:

- licença ou assinatura de uso;
- planos com diferentes níveis de recursos;
- implantação e suporte para operações que precisem de acompanhamento dedicado;
- oferta hospedada em nuvem quando a arquitetura compartilhada estiver disponível.

## 4. Estado atual do produto

O sistema atual é um protótipo/MVP com persistência local, principalmente `localStorage`. Ele é adequado para validação local dos fluxos, mas ainda não oferece persistência centralizada, autenticação real ou operação multiusuário.

### 4.1 Funcionalidades existentes

- login de protótipo e proteção de rotas no cliente;
- Dashboard;
- PDV/Caixa;
- cadastro, edição e exclusão de produtos;
- identificação por código de barras;
- controle de estoque e validações de disponibilidade;
- finalização de vendas;
- pagamentos em dinheiro, PIX e cartão;
- cálculo de troco para pagamentos em dinheiro;
- histórico de vendas com busca, filtros, ordenação e paginação;
- exportação do histórico de vendas em PDF;
- abertura de caixa com valor inicial e data/hora;
- movimentação em dinheiro do caixa aberto;
- valor esperado, valor contado e diferença da conferência;
- fechamento definitivo de caixa;
- histórico de fechamentos com detalhes e filtro por data;
- página de Relatórios;
- página de Configurações;
- responsividade inicial para uso em dispositivos móveis.

### 4.2 Limites atuais

- os dados operacionais ficam no navegador e não são centralizados;
- a autenticação atual é de protótipo e não substitui autenticação real;
- ainda não existe autorização efetiva por perfil ou unidade;
- o sistema atual não deve ser descrito como multiunidade implementado;
- alteração de e-mail e senha está preparada visualmente, mas ainda não realiza alterações reais;
- não há recuperação de senha por e-mail neste momento;
- alterações de autenticação não devem ser simuladas com `localStorage`.

## 5. MVP atual

O MVP contempla o ciclo operacional básico de uma padaria:

1. autenticar o operador no protótipo;
2. cadastrar produtos e manter estoque;
3. registrar vendas no PDV;
4. aceitar dinheiro, PIX e cartão;
5. consultar e exportar o histórico de vendas;
6. abrir um caixa com valor inicial;
7. acompanhar a movimentação em dinheiro;
8. contar o dinheiro e conferir a diferença;
9. fechar o caixa definitivamente;
10. consultar o histórico de caixas fechados.

A regra de negócio de que uma venda só pode ser finalizada com o caixa aberto deve ser preservada na evolução do sistema.

## 6. Visão multiunidade

O produto deve evoluir de uma estrutura de uma única padaria para uma estrutura multiunidade. O cenário real inicialmente considerado é um proprietário com duas padarias:

```text
Sistema
├── Padaria 1
│   ├── Caixa
│   ├── Vendas
│   ├── Estoque
│   └── Produtos
│
└── Padaria 2
    ├── Caixa
    ├── Vendas
    ├── Estoque
    └── Produtos
```

O proprietário deverá ter uma visão consolidada das duas unidades e poder filtrar os dados por unidade. A arquitetura não deve ficar rigidamente limitada a duas padarias: futuramente será possível cadastrar outras unidades.

Cada caixa, funcionário, venda, sessão de caixa, fechamento e estoque operacional deverá estar vinculado à unidade correta. O fechamento de uma unidade não pode afetar o caixa de outra.

## 7. Perfis de usuário

Inicialmente existem dois perfis conceituais para orientar a futura autorização. Eles ainda não estão implementados como permissões reais.

### 7.1 Dono / Administrador

Perfil com acesso administrativo amplo. Deverá poder:

- visualizar todas as unidades;
- visualizar o Dashboard consolidado;
- filtrar dados por unidade;
- consultar vendas e históricos;
- acessar relatórios;
- administrar produtos e estoque;
- acompanhar fechamentos;
- acessar configurações;
- futuramente administrar usuários;
- futuramente administrar unidades.

### 7.2 Caixa / Funcionário

Perfil operacional vinculado a uma única padaria. Deverá acessar principalmente:

- PDV;
- abertura de caixa;
- movimentação do caixa;
- fechamento do caixa;
- consulta de produtos;
- histórico de vendas da própria unidade, conforme definição futura.

O caixa não deverá ter acesso administrativo completo. Não deverá poder visualizar dados da outra padaria, alterar configurações administrativas, administrar usuários, excluir produtos, alterar preços sem permissão, visualizar relatórios administrativos completos ou acessar informações financeiras de outra unidade.

## 8. Usuário e vínculo com unidade

Futuramente, cada usuário deverá possuir um vínculo com uma unidade. O modelo conceitual é:

```text
Usuário
├── id
├── nome
├── email
├── senha
├── role
└── bakeryId
```

Regras conceituais:

- dono: `role = owner`, com acesso às unidades autorizadas e à visão consolidada;
- caixa: `role = cashier`, com `bakeryId` definido e operação restrita àquela unidade.

Isso é uma definição de arquitetura futura. Não implementar agora.

## 9. Vendas e caixa por unidade

### 9.1 Venda

Cada venda deverá futuramente estar associada a uma unidade:

```text
Venda
├── id
├── bakeryId
├── date
├── items
├── total
└── paymentMethod
```

Uma venda realizada na Padaria 1 não pode ser confundida com uma venda da Padaria 2.

### 9.2 Sessão de caixa

Cada sessão de caixa deverá pertencer a uma unidade:

```text
Caixa
├── id
├── bakeryId
├── openedAt
├── initialAmount
├── closedAt
├── countedAmount
├── expectedAmount
└── differenceAmount
```

A regra atual de exigir caixa aberto para finalizar uma venda deve ser preservada. O encerramento de uma sessão deve afetar apenas a unidade e o caixa correspondentes.

## 10. Produtos e estoque

Produto e estoque da unidade são conceitos diferentes. O cadastro do produto poderá ser compartilhado entre unidades, enquanto o estoque e outros dados operacionais deverão ser vinculados à unidade.

Exemplo:

```text
Produto compartilhado
Nome: Pão francês
Código: 7891000100015

Padaria 1: estoque 120
Padaria 2: estoque 65
```

Essa separação deve orientar a futura modelagem do banco de dados. O mesmo produto pode existir em várias padarias sem que o saldo de uma unidade altere o saldo da outra.

## 11. Dashboard e relatórios

### 11.1 Dashboard

O Dashboard deverá possuir níveis de visualização de acordo com o perfil.

Para o dono:

- visão consolidada das unidades;
- vendas e quantidade de vendas;
- valores em dinheiro, PIX e cartão;
- situação dos caixas;
- filtro por unidade;
- futuramente comparação entre unidades.

Para o caixa:

- visão restrita à própria unidade;
- nenhum dado da outra padaria;
- apenas informações necessárias à operação autorizada.

### 11.2 Relatórios

Os relatórios deverão respeitar a unidade e o perfil de acesso. O dono poderá visualizar todas as unidades, filtrar por unidade, analisar vendas, produtos mais vendidos, estoque e fechamentos.

O caixa não deverá possuir o mesmo nível de acesso aos relatórios administrativos.

## 12. Configurações e autenticação futura

A página Configurações deve continuar simples. A estrutura visual existente contempla alteração de e-mail e senha, mas essas ações ainda não são reais.

Quando houver backend, banco de dados e autenticação persistente, a evolução deverá incluir:

- usuários persistidos no banco;
- senha armazenada de forma segura;
- controle de sessão;
- autorização por perfil;
- autorização por unidade;
- alteração real de dados de autenticação.

Não implementar recuperação de senha por e-mail neste momento. Não antecipar autenticação real sem solicitação.

## 13. Direção arquitetural futura

A futura camada de persistência deverá registrar, conceitualmente, entidades como:

- `users`;
- `bakeries`;
- `products`;
- `product_stocks`;
- `sales`;
- `sale_items`;
- `cash_registers`;
- `cash_closures`.

Não é necessário definir SQL neste documento. A finalidade é registrar as relações de negócio que orientarão a futura implementação:

- um usuário pode ser dono ou caixa, com vínculo de unidade quando aplicável;
- uma unidade possui vendas, caixas, fechamentos e estoques operacionais;
- um produto pode ser compartilhado entre unidades;
- o estoque de um produto é separado por unidade;
- uma venda possui itens, unidade e forma de pagamento;
- uma sessão de caixa e seu fechamento pertencem à unidade correspondente.

### Arquitetura atual

- frontend em React com TypeScript;
- Vite como ferramenta de desenvolvimento e build;
- React Router para navegação;
- páginas organizadas por domínio em `src/pages`;
- tipos de domínio em `src/types`;
- acesso e persistência local em `src/data`;
- dados operacionais persistidos no navegador, principalmente em `localStorage`.

### Evolução esperada

Quando houver necessidade validada, as implementações locais de `src/data` poderão ser substituídas gradualmente por clientes de API. Regras financeiras e de autorização deverão migrar para uma camada confiável no servidor antes de uso distribuído ou comercial.

## 14. Experiência de uso

A interface desktop deve priorizar a operação administrativa, a organização dos dados e a produtividade. A experiência mobile deve ser uma prioridade para o proprietário acompanhar o negócio, principalmente em:

- Dashboard;
- Relatórios;
- Histórico de vendas;
- Histórico de fechamentos.

Responsividade não deve ser tratada apenas como redução do tamanho do desktop. O PDV é uma ferramenta operacional e pode ter uma experiência diferente das telas de acompanhamento gerencial.

## 15. Segurança e limites de implementação

O uso atual de `localStorage` e a autenticação no cliente são adequados apenas ao protótipo local. Antes de uso distribuído ou comercial, será necessário avaliar:

- autenticação real e armazenamento seguro de credenciais;
- autorização no servidor;
- isolamento entre unidades e usuários;
- validação de entrada no cliente e no servidor;
- trilhas de auditoria para operações financeiras;
- backups, recuperação e retenção de dados;
- transporte seguro e gerenciamento de segredos.

Nenhuma dessas garantias futuras deve ser presumida com base na implementação atual.

## 16. Princípios do produto

1. Simplicidade para o operador de caixa.
2. Visão administrativa completa para o proprietário.
3. Separação clara entre unidades.
4. Controle de acesso por perfil.
5. Dados financeiros vinculados à unidade correta.
6. Estoque vinculado à unidade.
7. Interface desktop para operação administrativa.
8. Boa experiência mobile para o proprietário acompanhar o negócio.
9. Não criar funcionalidades fictícias apenas para simular backend.
10. Evoluir do protótipo com `localStorage` para backend e banco de dados posteriormente.

## 17. Roadmap conceitual

### Etapa atual

- consolidar as funcionalidades do protótipo;
- melhorar a responsividade;
- definir a arquitetura multiunidade;
- definir perfis e permissões conceituais;
- manter a documentação alinhada ao estado real do produto.

### Próxima etapa

- preparar a estrutura de dados para unidades;
- preparar a separação lógica dos dados;
- revisar o acesso por perfil;
- identificar regras que precisam ser centralizadas antes do backend.

### Etapa de backend

- introduzir banco de dados;
- implementar autenticação real;
- persistir usuários e unidades;
- centralizar a persistência;
- implementar autorização por perfil e unidade.

### Etapa posterior

- gerenciamento de usuários;
- gerenciamento de unidades;
- Dashboard consolidado;
- filtros por unidade;
- relatórios multiunidade;
- possíveis integrações reais de pagamento.

As etapas acima são direcionadores de evolução, não funcionalidades disponíveis atualmente.

## 18. Regra para futuras implementações

Antes de implementar qualquer funcionalidade que envolva usuário, caixa, venda, estoque, relatório, unidade ou permissões, consultar este plano.

Não antecipar backend, banco de dados, autenticação real ou autorização sem solicitação. Não inventar regras de negócio que não estejam definidas. Quando uma regra ainda estiver em aberto, registrá-la como decisão futura antes de implementá-la.

## 19. Processo de desenvolvimento

```text
IMPLEMENTAR
    ↓
TESTAR
    ↓
APROVAR
    ↓
SEPARAR O DIFF POR FUNCIONALIDADE
    ↓
COMMIT LOCAL
    ↓
PRÓXIMA FUNCIONALIDADE
```

Cada alteração deve ter escopo controlado, preservar funcionalidades aprovadas e manter a documentação e as validações atualizadas. Commits devem usar Conventional Commits e representar uma única funcionalidade lógica.

## 20. Visão de longo prazo

O Padaria PDV poderá se tornar uma plataforma operacional para padarias e outros pequenos estabelecimentos, conectando vendas, estoque, caixa e gestão em uma base confiável, segura e acessível em diferentes dispositivos.

Essa visão depende da validação contínua do produto e de uma evolução técnica gradual. A complexidade deve ser introduzida conforme a necessidade real de múltiplas unidades, usuários, dispositivos e operações comerciais.
