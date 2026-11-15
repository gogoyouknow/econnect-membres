-- 0082 : objet des rappels 2 h avant : « notre appel » (et non « ton appel »).
update public.cand_cseq set subject = '{prenom}, notre appel est dans 2 h : as-tu regardé la vidéo ?' where cond = 'not_played' and anchor = 'before';
update public.cand_cseq set subject = '{prenom}, notre appel est dans 2 h : prépare bien tes questions' where cond = 'played' and anchor = 'before';
