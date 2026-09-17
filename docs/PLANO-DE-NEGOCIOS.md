# Plano de Negócios — Padaria PDV

## 1. Visão do produto

O Padaria PDV é uma solução de ponto de venda voltada à operação de padarias. A visão do produto é oferecer uma rotina simples e confiável para cadastrar produtos, vender, controlar o estoque e acompanhar a movimentação do caixa.

O produto está sendo construído por etapas, começando pelos fluxos essenciais de uma operação de balcão e evoluindo gradualmente para uma solução mais integrada e escalável.

## 2. Problema

Pequenas operações podem ter dificuldade para manter produtos, vendas, estoque e caixa organizados em ferramentas separadas ou processos manuais.

O Padaria PDV busca reduzir essa fragmentação ao reunir os principais fluxos operacionais em uma aplicação única, com informações mais fáceis de consultar e uma conferência de caixa orientada por etapas.

## 3. Público-alvo

- Padarias de pequeno e médio porte;
- Proprietários que precisam acompanhar a operação de vendas;
- Operadores de caixa;
- Pessoas responsáveis pela conferência e fechamento do caixa;
- Futuros gestores que precisem acompanhar produtos, estoque e histórico operacional.

## 4. Proposta de valor

O Padaria PDV pretende oferecer:

- operação de venda objetiva;
- cadastro de produtos com código de barras;
- acompanhamento básico de estoque;
- suporte a dinheiro, PIX e cartão;
- conferência de caixa baseada nos dados da sessão aberta;
- histórico consultável de vendas e fechamentos;
- evolução gradual, com baixo acoplamento entre os módulos.

## 5. Estado atual do produto

### Implementado

- Login e proteção das rotas administrativas;
- Dashboard;
- Cadastro, edição e exclusão de produtos;
- Código de barras e controle de estoque;
- PDV e finalização de vendas;
- Pagamentos em dinheiro, PIX e cartão, incluindo cálculo de troco;
- Histórico de vendas com busca, filtros, ordenação, paginação e exportação em PDF;
- Abertura de caixa com valor inicial e registro automático de data/hora;
- Movimentação em dinheiro desde a abertura;
- Valor esperado, valor contado e diferença;
- Fechamento definitivo com registro de uma fotografia da sessão;
- Histórico de fechamentos com detalhes e filtro por data de fechamento.

### Em evolução

- Refinamento da experiência das telas administrativas;
- Consolidação da documentação técnica e de produto;
- Aprimoramento gradual dos fluxos de caixa e consulta operacional.

### Planejado

Os itens abaixo são possibilidades futuras e não fazem parte da implementação atual:

- backend e banco de dados compartilhado;
- autenticação real e gestão de usuários;
- permissões por função;
- persistência em nuvem e sincronização;
- backups e auditoria;
- suporte a múltiplas empresas.

## 6. MVP

O MVP atual contempla o ciclo operacional básico de uma padaria:

1. autenticar o operador;
2. cadastrar produtos e manter estoque;
3. registrar vendas no PDV;
4. aceitar dinheiro, PIX e cartão;
5. consultar o histórico de vendas;
6. abrir um caixa com valor inicial;
7. acompanhar a movimentação em dinheiro;
8. contar o dinheiro e conferir a diferença;
9. fechar o caixa;
10. consultar o histórico de caixas fechados.

A persistência atual é local, adequada ao estágio presente do produto, mas ainda não substitui uma arquitetura compartilhada para uso distribuído.

## 7. Roadmap

### Fase 1 — Operação essencial

- consolidar os fluxos atuais de produtos, estoque, PDV e caixa;
- manter validações, consistência visual e documentação atualizadas;
- ampliar a cobertura de testes dos fluxos críticos.

### Fase 2 — Gestão operacional

- evoluir consultas e relatórios conforme necessidades reais da operação;
- avaliar recursos de auditoria e rastreabilidade;
- identificar pontos que exigem persistência compartilhada.

### Fase 3 — Plataforma compartilhada

- introduzir backend e banco de dados;
- substituir a autenticação local por autenticação real;
- suportar múltiplos usuários, permissões e sincronização;
- estruturar backups e recuperação de dados.

### Fase 4 — Escala do produto

- avaliar suporte a múltiplas empresas;
- evoluir integrações e operação em nuvem;
- expandir os módulos somente após validar as necessidades do produto.

## 8. Modelo de negócio

O modelo de negócio ainda não está definido. Possibilidades a serem avaliadas, sem decisão de preço ou formato:

- licença ou assinatura para uso do sistema;
- planos com diferentes níveis de recursos;
- implantação e suporte para operações que precisem de acompanhamento dedicado;
- oferta hospedada em nuvem quando a arquitetura compartilhada estiver disponível.

Essas são hipóteses para investigação futura. Não há preços, metas de faturamento ou métricas comerciais definidas neste documento.

## 9. Evolução técnica planejada

O produto pode evoluir gradualmente para:

- backend e API para centralizar regras e dados;
- banco de dados para substituir a persistência local operacional;
- autenticação real, sessões e recuperação de acesso;
- múltiplos usuários e permissões por função;
- suporte a múltiplas empresas e isolamento de dados;
- persistência em nuvem e sincronização entre dispositivos;
- backups automatizados e procedimentos de restauração;
- auditoria de operações importantes;
- camadas adicionais de segurança e observabilidade.

Todos esses recursos são futuros. A implementação atual usa React, TypeScript, rotas protegidas no cliente e `localStorage` para os dados operacionais.

## 10. Arquitetura

### Arquitetura atual

- Frontend em React com TypeScript;
- Vite como ferramenta de desenvolvimento e build;
- React Router para navegação;
- páginas organizadas por domínio em `src/pages`;
- tipos de domínio em `src/types`;
- acesso e persistência local em `src/data`;
- vendas, caixa aberto e fechamentos com estruturas próprias;
- estilos locais por página combinados com estilos compartilhados do Dashboard;
- dados persistidos no navegador por `localStorage`.

### Caminhos de evolução

Uma evolução possível é manter as páginas e tipos como fronteiras de domínio, substituindo gradualmente as implementações de `src/data` por clientes de API. Regras de negócio críticas devem migrar para uma camada confiável no servidor quando houver múltiplos usuários ou dispositivos.

## 11. Segurança

O uso atual de `localStorage` e a autenticação no cliente são adequados apenas ao estágio local/protótipo do produto. Antes de um uso distribuído ou comercial, será necessário avaliar:

- autenticação real e armazenamento seguro de credenciais;
- autorização no servidor;
- proteção contra acesso indevido aos dados;
- validação de entrada no cliente e no servidor;
- isolamento entre empresas e usuários;
- trilhas de auditoria para operações financeiras;
- backups, recuperação e retenção de dados;
- transporte seguro e gerenciamento de segredos.

Nenhuma dessas garantias futuras deve ser presumida com base na implementação local atual.

## 12. Estratégia para novos desenvolvedores

- Entender o projeto e o fluxo local antes de alterar código;
- Implementar uma funcionalidade por vez;
- Preservar funcionalidades existentes;
- Testar o comportamento e executar as validações antes do commit;
- Usar Conventional Commits;
- Não misturar alterações não relacionadas;
- Não descartar alterações de outros desenvolvedores;
- Não realizar push sem autorização do responsável.

## 13. Processo de desenvolvimento

```text
IMPLEMENTAR
    ↓
TESTAR
    ↓
APROVAR
    ↓
COMMIT
    ↓
PRÓXIMA FUNCIONALIDADE
```

O processo favorece mudanças pequenas, revisão clara e rastreabilidade por funcionalidade.

## 14. Visão de longo prazo

No longo prazo, o Padaria PDV pode se tornar uma plataforma operacional para padarias, conectando vendas, estoque, caixa e gestão em uma base confiável, segura e acessível em diferentes dispositivos.

Essa visão depende da validação contínua do produto, da adoção por operações reais e de uma evolução técnica gradual. Recursos de escala devem ser introduzidos quando houver necessidade comprovada, evitando complexidade prematura.

## 15. Princípios do projeto

- Simplicidade nas rotinas de operação;
- Manutenção como requisito desde o início;
- Evolução gradual e orientada por necessidades reais;
- Experiência do usuário clara e consistente;
- Consistência visual entre os módulos;
- Código organizado por responsabilidades;
- Escalabilidade gradual;
- Evitar complexidade prematura;
- Preservar o que já foi testado e aprovado;
- Manter documentação alinhada ao estado real do produto.