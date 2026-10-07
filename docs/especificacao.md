# App do Aposentados FC — Especificação

Documento de referência do app (atualizado em 06/10/2026, com tudo que foi decidido e implementado). Os wireframes originais (HTML) estão em `telas/` e o escudo em `escudo.jpeg`. Onde o texto e o desenho divergirem, **vale o texto** (ver seção 12).

- **Site:** https://aposentados.vercel.app
- **Código:** github.com/kkaian/Aposentados (público)

## 1. Objetivo

Site instalável (PWA) para a pelada: registra jogos, gols, assistências e cartões, monta os times de cada pelada, calcula pódio e troféus do mês, controla mensalidades e o caixa, e deixa os jogadores se avaliarem. Funciona em iPhone e Android, sem custo de hospedagem ou banco.

## 2. Stack e operação

- **Front:** React + Vite + Tailwind + `vite-plugin-pwa`. Ícones: `lucide-react`. Fonte Barlow.
- **Back:** Supabase no plano gratuito (Postgres, Auth, Storage, RLS, Realtime e `pg_cron`). Sem servidor próprio: as regras ficam no banco (constraints, triggers e funções RPC).
- **Hospedagem:** Vercel, que publica sozinha cada push na `main`. O endereço e a chave pública (`publishable`) do Supabase ficam em `src/lib/supabase.js`; a proteção dos dados é o RLS.
- **Banco versionado:** migrações em `supabase/migrations/`. `npm run db:migrate` aplica as novas e `npm run db:test` roda os testes de regras e permissões (96 casos, numa transação desfeita no final; `-- --with=arquivo.sql` ensaia uma migração nova antes de aplicar). A senha do banco fica só no `.env.local`, fora do git.
- **Login:** só usuário + senha (sem Google). O Supabase usa um e-mail interno `usuario@aposentados.app`; a confirmação de e-mail fica desligada.
- **Fotos e escudos:** reduzidos no celular antes de enviar (foto ~100 KB, escudo ~60 KB). Trocar a foto substitui a antiga. Limite de 200 KB por arquivo.
- **Instalação:** item "Instalar app" no menu. No Android abre o aviso do Chrome (`beforeinstallprompt`); no iPhone mostra as instruções do Safari. O item some quando o app já está instalado. O app se atualiza sozinho (às vezes é preciso fechar e abrir).
- **Rotinas automáticas (`pg_cron`):** relógio da escolha dos times (a cada minuto) e mensalidade do mês (diária).
- **Backup:** GitHub Action a cada 3 dias exporta todas as tabelas em CSV, criptografa (o repositório é público) e guarda por 90 dias. Também evita que o Supabase pause por inatividade. Secrets: `SUPABASE_DB_URL` (pooler `aws-0-sa-east-1`) e `BACKUP_PASSPHRASE`.
- **Fora do escopo:** modo sem internet, avisos por WhatsApp, importação do caderno antigo.

## 3. Visual e navegação

Tema escuro, seguindo o escudo. Fundo `#0B1226`, superfície `#101A38`, borda `#243256`, texto `#E6EAF2`, texto apagado `#8D9AB8`, azul de ação `#3D78FF`, prata `#D8DEE9`. Medalhas: ouro `#D9B44A`, prata `#C0C7D1`, bronze `#B87B4B`. Ícone do PWA gerado do escudo.

- **Barra inferior:** Início, Pelada, Pagamentos, Jogadores.
- **Topo:** menu (☰), escudo, título e a foto do jogador (abre o próprio perfil).
- **Menu lateral:** Início, Pelada de hoje, Jogadores, Histórico, Times da pelada, Avaliar colegas, Pagamentos, Perfil, Instalar app; seção Admin (Administração, Caixa, Sorteio de times, Adicionar diarista) só para admins; Sair.

**Cores dos times** (lista fixa):

| Cor | Hex |
|---|---|
| Azul | `#2D5BA8` |
| Vermelho | `#B3362B` |
| Branco | `#D8DEE9` |
| Preto | `#1B1B1B` |
| Verde | `#2E8B57` |
| Amarelo | `#E0B000` |
| Laranja | `#E06A1F` |
| Roxo | `#6B3FA0` |
| Cinza | `#7A8394` |
| Grená | `#7A1F2B` |

## 4. Papéis e tipos de jogador

**Papéis fixos:** dono, admin e jogador. **Ajudante** não é papel fixo: é escolhido em cada pelada e vale só para ela.
- **Dono:** os mesmos direitos do admin e, a mais, escolhe e remove admins. Pode passar a posse para outro admin e continua como admin. Só existe um dono.
- **Admin:** edita e exclui qualquer dado, aprova cadastros, gerencia peladas, times, kits, mensalistas, pagamentos e o caixa.
- **Ajudante:** registra os jogos daquela pelada (quando é o responsável), define o próximo jogo, preenche vagas e empresta jogadores.
- **Jogador:** vê tudo (menos o caixa); botões de registro aparecem trancados.

**Tipos:**
- **Mensalista:** paga mensalidade, marca presença sozinho, pode ser capitão, entra no pódio, nos troféus e nas notas.
- **Diarista:** todo mundo começa assim. Tem perfil e histórico, mas fica fora do pódio, dos troféus e das notas. Só marca presença numa pelada se o admin o chamar, e o admin **só pode chamar quando falta mensalista** para os 20 lugares (4 times de 5): há menos de 20 mensalistas ou algum disse "Não vou". Se o mensalista voltar a ir, o diarista sai da lista de disponíveis da escolha.
- **Avulso:** sem conta, só o nome, criado na hora. Gols e assistências ficam só no histórico do dia.

**Admin e tipo são independentes:** o pódio olha só o tipo. Quem vira admin começa como mensalista (se houver vaga na cota), mas pode ser retirado da mensalidade e continuar admin; nesse caso conta como diarista.

**Cota:** número máximo de mensalistas, definido pelo admin. Promover diarista só havendo vaga. Retirar um mensalista o torna diarista; perfil e histórico continuam.

## 5. Regras

### Pelada e mês (duas coisas separadas)

- **A pelada é um evento com data**, todo domingo. Cada pelada é criada pelo admin (data, horário, local, vagas, ajudantes, diaristas chamados, presença aberta) e tudo dela vale só para ela.
- **Tudo do time é da pelada:** capitães, jogadores, kit e cor são escolhidos de novo a cada pelada.
- **O mês guarda as estatísticas individuais:** gols, assistências, vitórias, pódio e troféus somam as **peladas encerradas** do mês (fuso de São Paulo). Meses e anos nunca se misturam.

### Presença

Vou/Não vou, atualizando ao vivo. Marcam presença os mensalistas e os diaristas chamados pelo admin. **A presença é só um status** (vai, dúvida para quem não respondeu, não vai): a escolha dos times não depende dela, e definir os capitães não marca presença por eles.
- "Vou" vale enquanto a lista está aberta; "Não vou" (**Desfazer ida**, para emergências) vale até a pelada acabar.
- Quem já está num time e responde "Não vou" sai do time e fica uma **vaga de diarista** no lugar; os admins são avisados e preenchem com avulso ou alguém com conta, ou deixam a vaga e, no jogo, alguém de outro time completa (Emprestar). Se a pessoa voltar para "Vou" antes de a vaga ser preenchida, volta para o time.
- **Admin marca por outra pessoa** (faltou sem avisar): tocando no jogador na lista de Presença ou no card do time em Pelada de hoje, escolhe "Vai" ou "Não vai". Vale a mesma regra da vaga de diarista.

### Times da pelada

1. O admin escolhe 4 capitães entre os mensalistas. A ordem em que os define é a ordem das escolhas.
2. São 16 escolhas em 4 rodadas: **1-2-3-4 · 4-1-2-3 · 1-2-3-4 · 1-2-3-4** (intencional: a ordem dá vantagem, e o capitão 4 é compensado só na 2ª rodada).
3. **24 h livres** depois de definir os capitães (respeitando a ordem). Depois, **10 min por escolha**; sem escolha, o app sorteia. Tudo roda no servidor, mesmo com o app fechado.
4. **Disponíveis:** mensalistas e diaristas chamados que ainda não estão em um time, menos quem disse "Não vou". A lista mostra quem vai e quem está em dúvida; o sorteio automático prefere quem confirmou.
5. **Vaga de diarista:** quando não sobra ninguém disponível, o capitão da vez escolhe "Vaga de diarista" (não pode antes disso). Prazo vencido sem disponíveis vira vaga sozinho. No horário da pelada, o que faltar vira vaga e cada time fecha com 5.
6. **Kit e cor:** cada capitão escolhe um kit (nome + escudo, cadastrados juntos) e uma cor, **só na vez dele de escolher um jogador** (depois que a escolha termina, fica livre; o admin pode sempre). Na mesma pelada, quem escolhe primeiro bloqueia o kit e a cor; na pelada seguinte tudo fica livre. Até escolher, o time aparece como "Time de Fulano".
7. **Kits novos:** só se o admin liberar a criação (economia de armazenamento). Com a criação desligada, o capitão pode sugerir um kit e o admin aprova.
8. **Trocar capitão (admin):** outro mensalista do mesmo time vira capitão (ex.: o capitão teve uma emergência). Time, escolhas, ordem, kit e cor continuam; a vez do time passa a ser do novo capitão. "Refazer capitães" continua existindo, mas apaga a escolha.
9. **Sorteio (dia atípico, só admin):** marca quem joga, 2 a 4 times, opção de equilibrar pelo overall (sem overall conta como 3), troca manual tocando em dois jogadores. Substitui os times da pelada, desde que nenhum jogo tenha começado.

### No dia da pelada

- **Preencher vaga** (admin ou ajudante): avulso, diarista com conta ou mensalista de última hora. Opção "pagou para jogar" (valor e quem recebeu) vai para o caixa. Vaga não preenchida não entra em campo.
- **Substituição integral** (admin): alguém que não vai sai do time e entra um diarista com conta ou avulso, com pagamento opcional para o caixa.
- **Próximo jogo:** admin ou ajudante escolhe os dois times. Não há regra automática de quem fica ou sai.

### Jogo ao vivo

- O jogo termina com **10 min ou 2 gols**: o app avisa e mostra o placar final com "Salvar resultado". Depois de salvo, só admin corrige.
- **Empate:** ao salvar, escolhe-se "Empate" ou qual time **venceu nos pênaltis**. Vitória nos pênaltis conta como vitória (pódio, troféus, Seleção do mês); os gols dos pênaltis não entram no placar. Admin pode trocar depois.
- **Responsável pelo registro:** quem inicia o jogo. Um por vez; pode passar para um ajudante ou admin, o admin assume ou libera. Os outros acompanham ao vivo com os botões trancados.
- **Eventos:** gol (com passo 2: assistência ou "sem assistência"), gol contra (conta para o adversário e não entra no ranking de gols), cartão amarelo e vermelho (só registro, sem suspensão) e substituição.
- **Substituição parcial:** entra mensalista, diarista, avulso ou **alguém de outro time**. **Emprestar jogador:** coloca alguém em campo sem tirar ninguém (lesão, time com 4). Os dois valem só para aquele jogo; no próximo jogo do time dele, o jogador volta ao time original.
- **Créditos:** gols, assistências e vitória contam para o time em que o jogador esteve em campo naquela partida.
- **Só admin edita ou exclui eventos.** Excluir uma substituição desfaz a troca em campo. Erro ao salvar mostra "Tentar de novo".
- **Encerrar pelada** (admin, com todos os jogos finalizados): resumo do dia (artilheiro, garçom, time com mais vitórias). Só então os números entram no mês. Encerrar também libera as notas de novo.

### Pódio (aba Início)

Abas Total, Vitórias, Gols e Assistências. Total = gols + assistências. Desempate por vitórias. Empate em tudo: mesma posição e a seguinte é pulada (1, 2, 2, 4). Ranking completo com top 3 em destaque. Só mensalistas. Um mês por vez, com o ano no título quando não é o ano atual.

### Troféus do mês

Aparecem no perfil a partir do dia 1º do mês seguinte, calculados na hora (correções de eventos ajustam os troféus). Só mensalistas. Sem troféu: "Sem troféus ainda".
- **Melhor do mês** (🏆 🥈 🥉): gols + assistências, desempate por vitórias. 1º, 2º e 3º.
- **Artilheiro** (⚽), **Garçom** (🎯) e **Mais vitórias** (💪): só o 1º; empate premia todos.
- **Seleção do mês** (⭐): o time com mais vitórias numa pelada do mês; desempate por gols; empate de novo, os dois levam. Ganham os mensalistas do time naquela pelada (quem saiu em troca integral ou foi só emprestado não leva).

### Notas

Drible, chute, velocidade, defesa, passe e overall, de 1 a 5 estrelas. Só mensalistas avaliam e são avaliados. Voto anônimo (ninguém vê quem deu a nota pelo app), sem votar em si mesmo, opcional. Cada nota de cada jogador muda **1 vez por pelada**: libera de novo quando o admin encerra a pelada. A nota anterior continua valendo. A média usa o voto mais recente de cada pessoa e só aparece com 3 ou mais avaliações. Notas antigas sem defesa e passe podem ser completadas sem gastar a mudança.

### Pagamentos

- **Pix manual:** o jogador paga, toca "Já paguei" e um admin confirma (escolhendo quem recebeu, o que lança no caixa). "Desfazer" volta um pagamento confirmado por engano.
- **Mensalidade:** valor e dia de vencimento definidos pelo admin. A do mês atual é criada sozinha; o admin cria a do mês seguinte quando quiser (até 2 meses à frente). Cada cobrança vale para os mensalistas do momento em que foi criada; quem vira mensalista entra na do mês e nas já criadas para frente, nunca nas antigas.
- **Cotinhas:** cobranças extras (bola, colete), para os mensalistas.
- **O jogador vê** todas as cobranças em aberto (atrasadas, do mês, adiantadas) e o histórico do que já pagou. Passou do vencimento sem pagar: "Atrasado".
- **O admin vê** "X de Y pagos" por cobrança e pode confirmar, desfazer ou **dispensar** alguém.

### Caixa (só admins)

- Entradas, gastos e saldo do mês, com saldo acumulado de um mês para o outro.
- Toda entrada diz com qual admin/dono o dinheiro ficou e todo gasto diz quem pagou; o caixa mostra quanto cada um tem na mão.
- Entram sozinhos: mensalidades e cotinhas confirmadas, diaristas que pagaram para jogar.
- Lançamentos manuais: entrada avulsa, gasto (nome e valor: society, água, juiz) e repasse entre admins (não muda o total).
- **Auditável:** nada é apagado. Lançamento errado é estornado com motivo, guardando quem lançou, quem estornou e quando. Exporta CSV do mês.

### Notificações

Ativadas por aparelho (perfil ou convite na tela de Início). Android: Chrome. iPhone: só com o app instalado na tela de início (iOS 16.4+).
- **Todos os chamados:** pelada marcada, diarista chamado e lembrete na véspera, ao meio-dia, para quem não respondeu.
- **Escolha:** você é capitão, sua vez de escolher (um aviso por vez, também quando começam os 10 min), você foi escolhido ou sorteado, times fechados.
- **Pagamentos:** confirmado; vencendo em 3 dias e no dia (para quem não pagou).
- **Admins:** cadastro novo, pedido de senha, "Já paguei".
- Como funciona: o banco decide quem avisar e chama `/api/push` (Vercel) por `pg_net`; as chaves VAPID ficam em `private.push_config`, fora do git. Aparelho que deixou de existir sai da lista sozinho.

### Cadastro e acesso

- **Cadastro:** código de convite (gerar um novo invalida o anterior) + aprovação do admin. Entra como diarista.
- **Esqueci minha senha:** o jogador pede pelo app e o pedido aparece para o admin em Cadastros.
- **Recuperar acesso:** em Jogadores e permissões, a chave ao lado do nome mostra o usuário e gera uma senha temporária para passar por fora do app. No próximo acesso o jogador é obrigado a criar a dele. O jogador também troca a senha pelo perfil.

## 6. Telas

| Tela | Rota | Quem acessa | Resumo |
|---|---|---|---|
| Login | `/` | todos | usuário/senha, esqueci minha senha, criar conta |
| Cadastro | `/cadastro` | novo | convite, nome, usuário, senha |
| Esqueci minha senha | `/esqueci-senha` | todos | pede senha temporária ao admin |
| Aguardando aprovação | — | cadastrado | até um admin aprovar |
| Criar nova senha | — | quem recebeu senha temporária | troca obrigatória |
| Início | `/` | logados | próxima pelada (Vou/Não vou) e pódio do mês |
| Jogadores | `/jogadores` | logados | todos os jogadores com dono/admin, mensalista/diarista, overall; busca e filtros |
| Perfil / Jogador | `/perfil`, `/jogador/:id` | logados | foto, estatísticas (mês/ano/geral), notas, troféus; trocar senha |
| Presença | `/presenca` | logados | vão, não vão, sem resposta, espera |
| Pelada de hoje | `/pelada` | logados | times, jogos do dia, próximo jogo, preencher vaga, encerrar |
| Times da pelada | `/times` | logados | escolha ao vivo, prazos, disponíveis, vaga de diarista |
| Meu time | `/times/meu` | capitão/admin | kit e cor; criar ou sugerir kit |
| Jogo | `/jogo/:id` | logados | placar, cronômetro, eventos, responsável, emprestar; detalhe depois de encerrado |
| Histórico | `/historico` | logados | peladas por mês, filtro de jogador |
| Avaliar colegas / jogador | `/notas`, `/notas/:id` | mensalistas | lista com estrelas; votação por jogador |
| Pagamentos | `/pagamentos` | logados | cobranças em aberto e pagas; parte do admin |
| Administração | `/admin` | admin | atalhos com pendências |
| Cadastros | `/admin/cadastros` | admin | convite, aprovações, pedidos de senha |
| Jogadores e permissões | `/admin/permissoes` | admin (funções: só dono) | funções, posse, recuperar acesso |
| Mensalistas e cota | `/admin/mensalistas` | admin | valor, vencimento, cota, em dia/atrasado |
| Peladas | `/admin/peladas` | admin | lista, criar e editar (ajudantes, diaristas chamados) |
| Definir capitães | `/admin/peladas/:id/capitaes` | admin | 4 capitães na ordem |
| Sorteio | `/admin/sorteio` | admin | dia atípico |
| Adicionar diarista | `/admin/diarista` | admin | substituição integral |
| Encerrar pelada | `/admin/encerrar/:id` | admin | resumo do dia |
| Caixa | `/admin/caixa` | admin | entradas, gastos, repasses, com quem está o dinheiro |
| Nomes e escudos | `/admin/kits` | admin | kits, criação pelos capitães, sugestões |
| Exportar dados | `/admin/exportar` | admin | CSVs |

## 7. Modelo de dados

- **Pessoas e acesso:** `profiles` (usuário, nome, foto, papel, tipo, status, troca de senha obrigatória) · `invites` · `password_requests` · `app_settings` (cota, mensalidade, Pix, criação de kits).
- **Kits:** `kits` (nome + escudo, ativo) · `kit_suggestions`.
- **Peladas:** `peladas` · `pelada_helpers` · `pelada_diaristas` · `guests` (avulsos) · `presence`.
- **Times:** `teams` (pelada, ordem do capitão, kit, cor; kit e cor únicos por pelada) · `team_members` (escolha, origem, vaga de diarista, troca integral) · `drafts` (fase, prazo, próxima escolha).
- **Jogos:** `games` (times, status, responsável) · `game_lineup` (quem esteve em campo e quando) · `game_events`.
- **Notas:** `ratings` (uma por avaliador e avaliado).
- **Dinheiro:** `charges` (mensalidades e cotinhas) · `payments` (uma por pessoa cobrada) · `cash_entries` (caixa).
- **Consultas (views):** `game_scores`, `player_month_stats`, `podium`, `awards`, `pelada_team_results`, `rating_summary` (médias sem revelar quem votou), `presence_list`.

## 8. Permissões (RLS)

- Visitante sem login não lê nada. Conta pendente vê só o próprio perfil.
- Jogador lê tudo, menos o caixa, as notas dos outros e o código de convite. Escreve só nome e foto do próprio perfil, a própria presença, as próprias notas e o "Já paguei".
- O responsável registra eventos do jogo dele. Ajudante define o próximo jogo, preenche vagas e empresta jogadores na sua pelada.
- Admin escreve em tudo; o caixa só por funções (sem apagar). Só o dono define admins e passa a posse.
- Fotos: cada um mexe só na própria pasta. Escudos: só admin (sugestões na pasta do capitão).

## 9. Situação

Todas as fases da especificação original estão implementadas e em uso desde 06/10/2026, além das adições: caixa, vagas de diarista, empréstimo, mensalidades por período, notas de defesa e passe por pelada, aba Jogadores e recuperação de acesso pelo admin.

Ideias para depois:
- Atualização automática do app aberto em segundo plano (sem precisar fechar).
- Gasto fixo do mês no caixa (lançar com um toque).
- Resumo do caixa visível para os jogadores (opcional).
- Descartar votos muito fora da curva nas médias.

## 10. Como o admin opera (resumo)

1. Passa o link e o convite; aprova em **Cadastros**; promove em **Mensalistas e cota** e, se for o caso, em **Jogadores e permissões**.
2. Cria a pelada do domingo em **Peladas** (com ajudantes e diaristas chamados).
3. Depois das presenças, define os capitães; a escolha corre sozinha com os prazos.
4. No dia: preenche vagas, define os jogos, registra (ou deixa com o ajudante), salva cada resultado e **encerra a pelada**.
5. Confirma os pagamentos (escolhendo quem recebeu) e lança os gastos no **Caixa**.

## 11. Decisões tomadas (histórico)

- Admin que não é mensalista conta como diarista.
- Ajudante é escolhido por pelada.
- Pelada todo domingo; times, kits e cores refeitos a cada pelada; o mês guarda só as estatísticas individuais.
- Escolha: 24 h livres e depois 10 min por escolha, sem a regra das 18h; ordem 1234 · 4123 · 1234 · 1234.
- Kit é o par nome + escudo; cor da lista fixa; ambos bloqueados por pelada.
- Disponíveis na escolha: todos os mensalistas (e diaristas chamados), menos quem disse "Não vou"; vaga de diarista só quando não sobra ninguém. Presença é só status (07/10/2026).
- "Não vou" de quem está num time vira vaga de diarista; "Desfazer ida" até a pelada acabar.
- Kit e cor só na vez do capitão durante a escolha.
- Diarista só é chamado/escolhido quando falta mensalista para os 20 lugares. Admin pode trocar o capitão sem refazer a escolha.
- Sem login com Google; recuperação de acesso pelo admin.
- Notas mudam 1 vez por pelada (antes era 1 vez por mês).
- Mensalidade vale para os mensalistas do momento em que a cobrança é criada.
- Empate pode ser decidido nos pênaltis e conta como vitória.
- Notificações por Web Push, sem custo, com os avisos da seção 5.
- A escolha dos times termina antes do horário da pelada (o que faltar é sorteado).
- Pelada de 04/10/2026 (feita no papel) lançada direto no banco.

## 12. Onde os wireframes estão desatualizados

- "Sábado" → **domingo**. "Times do mês" / "times valem pelo mês" → **times da pelada**.
- "Time Azul/Vermelho/Branco/Preto" fixos → times com **kit e cor escolhidos** a cada pelada.
- `Identidade`: nome e escudo separados → **kit** (par nome + escudo).
- `CriarPelada` e `Presenca`: "mensalistas e admins" → só **mensalistas** (e diaristas chamados).
- `Permissoes`: "Ajudante" na lista de funções → ajudante é só **por pelada**. `PassarPosse`: admin vira mensalista "automaticamente" → começa como mensalista, mas pode ser retirado.
- `Login`: botão do Google → **removido**.
- Barra inferior com "Perfil" → **Jogadores** (perfil pela foto no topo).
- Notas com 4 critérios e "1 vez por mês" → **6 critérios** e **1 vez por pelada**.
- `Pagamentos`: só a mensalidade do mês → **todas as cobranças em aberto** e histórico.
- `Capitaes`, `Jogo`: sem vaga de diarista nem empréstimo → ver seção 5.
