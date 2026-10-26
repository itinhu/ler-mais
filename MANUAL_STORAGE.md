# LER+ — gravação e avaliação manual (versão 3.2)

## Fluxo
- Professor cadastra aluno e e-mail do responsável.
- Responsável autenticado e com e-mail verificado grava em casa; professor pode gravar na escola.
- Áudio de até 60 segundos e 3,6 MB é enviado por URL assinada temporária diretamente ao bucket privado.
- Professor responsável abre **Painel**, seleciona o aluno, ouve a gravação e informa palavras lidas, erros e observações.
- O servidor calcula palavras corretas por minuto (PCPM) e precisão; o histórico fica no Firestore.
- Transcrição automática foi desativada; não é necessária OPENAI_API_KEY.

## Configuração necessária antes de publicar
1. Firebase Console → projeto `ler-mais-fluencia` → **Storage**. O Storage exige plano Blaze com faturamento vinculado. Avalie os custos e habilite alertas.
2. Crie o bucket `ler-mais-fluencia.firebasestorage.app` (ou informe o nome real via `FIREBASE_STORAGE_BUCKET` na Vercel).
3. Publique as regras de `storage.rules` no painel do Storage. Elas negam acesso direto do SDK cliente; as URLs assinadas são emitidas apenas pelo servidor após verificar o vínculo do aluno.
4. Configure **CORS** do bucket para permitir PUT do domínio da aplicação. Exemplo `cors.json`:
   ```json
   [{"origin":["https://ler-mais-fluencia.vercel.app"],"method":["PUT"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
   ```
   Execute `gcloud storage buckets update gs://SEU_BUCKET --cors-file=cors.json` em ambiente com acesso ao projeto Google Cloud.
5. Mantenha `FIREBASE_SERVICE_ACCOUNT_JSON` apenas na Vercel. A conta de serviço precisa poder assinar URLs V4 e gravar/ler objetos no bucket; em alguns projetos são necessárias permissões adicionais para assinatura.
6. Faça deploy e teste com aluno fictício, em Chrome e Safari/mobile.

## Segurança e operação
- NÃO use dados de alunos reais sem base legal adequada, informação/consentimento dos responsáveis, política de retenção e exclusão, e revisão de segurança/LGPD.
- URLs assinadas são temporárias e devem ser tratadas como segredo enquanto válidas.
- Restrinja acesso ao bucket e não ative regras públicas.
- Limites: 3,6 MB, 60 segundos, até 15 gravações por aluno/usuário/dia (controle aplicativo).
- Implemente rotina de limpeza de uploads abandonados, política de exclusão e monitoramento antes de produção real.
- Avaliações antigas continuam no histórico; gravações antigas sem áudio não podem ser reproduzidas.
