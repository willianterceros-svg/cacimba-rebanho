# Cacimba Rebanho

Aplicação web para gestão de rebanho, movimentações e histórico reprodutivo da Agropecuária Cacimba.

O sistema é uma aplicação estática/PWA publicada em `https://cacimbarebanho.com.br`, com frontend em HTML, CSS e JavaScript e persistência em PostgreSQL pelo Supabase. O funcionamento offline usa IndexedDB e Service Worker.

## Estado atual

- frontend estático, sem etapa de build;
- publicação compatível com GitHub Pages;
- autenticação própria por usuário e senha, validada por Database Functions do Supabase;
- dados do rebanho separados por domínio no banco;
- sincronização incremental, sem envio do estado completo a cada alteração;
- armazenamento local em IndexedDB para uso offline;
- fila local de alterações pendentes (`outbox`);
- exportação e importação de backup em JSON;
- aplicação e dados não são carregados na interface antes do login;
- versão atual do frontend: `3.0.1-ajustada`.

## Tecnologias

- HTML5;
- CSS3;
- JavaScript sem framework;
- IndexedDB;
- Service Worker;
- Supabase/PostgreSQL;
- SheetJS para geração dos relatórios Excel;
- GitHub Pages e domínio personalizado.

## Estrutura do frontend

```text
.
├── index.html
├── assets/
│   └── css/app.css
├── src/
│   ├── api.js
│   ├── auth.js
│   ├── backup.js
│   ├── bootstrap.js
│   ├── config.js
│   ├── database.js
│   ├── genealogy.js
│   ├── state.js
│   ├── sync.js
│   └── ui.js
├── supabase/
├── tests/
├── manifest.webmanifest
└── sw.js
```

Responsabilidades dos módulos:

| Arquivo | Responsabilidade |
|---|---|
| `api.js` | Comunicação com as RPCs do Supabase |
| `auth.js` | Login, sessão, acesso offline e usuários |
| `backup.js` | Importação e exportação de backup JSON |
| `bootstrap.js` | Inicialização e eventos globais da aplicação |
| `config.js` | URL, chave pública e versão da aplicação |
| `database.js` | IndexedDB, versões locais e fila `outbox` |
| `genealogy.js` | Reprodutores, matrizes e vínculos genealógicos |
| `state.js` | Estado em memória e funções comuns de persistência |
| `sync.js` | Envio e recebimento incremental de alterações |
| `ui.js` | Regras da interface e operações do rebanho |

## Autenticação e autorização

A aplicação mantém a autenticação própria existente. Ela não usa Supabase Auth.

As principais funções de autenticação são:

- `rebanho_login`;
- `rebanho_change_password`;
- `rebanho_list_users`;
- `rebanho_create_user`;
- `rebanho_reset_user_password`;
- `rebanho_toggle_user`;
- `rebanho_delete_user`.

Os perfis utilizados são `OWNER`, `ADMIN` e `FIELD`. As Database Functions validam o token da sessão antes de consultar ou alterar dados.

A URL e a chave publishable/anon presentes em `src/config.js` são configurações públicas do frontend. Nunca devem ser colocadas nesse arquivo a senha do banco, uma chave `service_role` ou qualquer secret key.

## Modelo de dados

Os registros são separados nas seguintes tabelas:

| Tabela | Conteúdo |
|---|---|
| `rebanho_animals` | Animais e situação atual |
| `rebanho_movements` | Nascimentos, vendas e mortes |
| `rebanho_reproducers` | Cadastro de reprodutores |
| `rebanho_history` | Histórico e auditoria |
| `rebanho_historical_dams` | Matrizes históricas |
| `rebanho_pedigree` | Referências genealógicas |
| `rebanho_change_log` | Sequência usada pela sincronização incremental |
| `rebanho_applied_batches` | Controle de lotes já aplicados |
| `rebanho_imports` | Arquivo e resultado das importações JSON |

As tabelas de dados usam:

- `uid` como identificador estável;
- `data` como documento JSONB do registro;
- `version` para detectar edição concorrente;
- `deleted_at` para exclusão lógica;
- `updated_at` e `updated_by` para auditoria técnica.

As tabelas legadas `rebanho_users`, `rebanho_sessions` e `rebanho_state` são mantidas. A versão atual utiliza as duas primeiras para autenticação; `rebanho_state` não participa da sincronização incremental.

## Database Functions

O frontend não grava diretamente nas tabelas. Ele utiliza quatro RPCs:

| Função | Finalidade |
|---|---|
| `rebanho_push_changes` | Valida e salva um lote de alterações em uma transação |
| `rebanho_pull_changes` | Retorna alterações posteriores ao cursor local |
| `rebanho_export_backup` | Gera um backup JSON dos dados atuais |
| `rebanho_import_backup` | Valida e distribui um backup JSON entre as tabelas |

Os arquivos SQL estão em `supabase/database-functions/<nome-da-funcao>/function.sql`. O esquema das tabelas está em `supabase/00-schema.sql`.

## Sincronização

Quando uma operação é realizada:

1. a interface altera o estado em memória;
2. `database.js` compara o estado atual com a versão local anterior;
3. somente os registros alterados são gravados no IndexedDB;
4. as alterações relacionadas são colocadas no mesmo lote da `outbox`;
5. quando há conexão, `rebanho_push_changes` valida e grava o lote inteiro;
6. `rebanho_pull_changes` baixa somente os eventos posteriores ao cursor local.

Uma venda, por exemplo, pode atualizar o animal e inserir movimentação e histórico no mesmo lote. Se uma parte falhar, toda a transação é revertida.

O `batch_id` evita duplicidade após repetição de requisição. Em conflito de versão, o servidor não é sobrescrito e o lote permanece no aparelho para conferência.

## Funcionamento offline

Depois do primeiro acesso online no aparelho:

- os arquivos da aplicação ficam disponíveis pelo Service Worker;
- os registros sincronizados ficam no IndexedDB;
- novos lançamentos são salvos primeiro localmente;
- a `outbox` mantém o que ainda não chegou ao servidor;
- ao recuperar a conexão, a sincronização é retomada.

O Service Worker não armazena o backup nem os registros do rebanho em cache HTTP. Esses dados ficam no IndexedDB. A biblioteca do Excel é armazenada para continuar disponível offline após a instalação inicial.

## Backup JSON

A exportação online usa `rebanho_export_backup`. Quando existem alterações locais pendentes ou em conflito, o arquivo prioriza o estado local e inclui:

- `payload`: estado local atual;
- `pendingOutbox`: lotes ainda não confirmados;
- `cloudBackup`: cópia do servidor, quando disponível.

A importação é restrita ao perfil `OWNER` e executada em uma única transação. Usuários, senhas e sessões não fazem parte do backup funcional do rebanho.

## Testes

Para executar as verificações estáticas:

```bash
npm test
```

Antes de publicar uma alteração, valide ao menos:

- login online e offline;
- carregamento sem dados antes do login;
- pesquisa e edição de animal;
- nascimento, venda e morte;
- sincronização entre dois aparelhos;
- fechamento e reabertura offline no Safari;
- exportação de backup JSON;
- relatórios Excel.

## Publicação

O projeto é publicado como site estático. O arquivo `CNAME` define `cacimbarebanho.com.br` como domínio personalizado.

Ao alterar arquivos do frontend, atualize a versão de cache em `sw.js` para que aparelhos já instalados recebam os novos arquivos. Mudanças em tabelas ou funções devem ser aplicadas primeiro em homologação e acompanhadas de backup.

Não versione:

- backups com dados reais;
- senha do banco;
- chave `service_role`;
- dumps de usuários ou sessões;
- arquivos contendo tokens ou secrets.

## Limitações conhecidas

- a importação de estoque por Excel ainda é somente uma prévia visual e não processa a planilha;
- a venda por planilha também permanece em modo demonstrativo;
- conflitos de edição são preservados, mas a resolução ainda exige conferência manual;
- o primeiro login e a troca da senha inicial exigem conexão.
