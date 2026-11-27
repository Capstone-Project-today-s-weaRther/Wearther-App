# 상의별 착용 이미지 매핑

`src/data-mirror/top-image-map.json`에서 `fashion_images.clothing_items`의 상의 명칭을 Pexels의 해당 의상 착용 사진으로 연결합니다.

현재 업로드된 `fashion_images_rows.csv`에서 확인한 상의 9종을 각각 별도의 사람 착용 사진 URL에 매핑했습니다. 각 항목에는 Pexels CDN 이미지 주소, 원본 사진 페이지, 촬영자, 대체 텍스트가 포함되어 있습니다.

이미지 바이너리는 이 작업 환경의 외부 이미지 서버 DNS 접근 제한으로 프로젝트 폴더에 내려받지 못했습니다. 따라서 사진은 인터넷 연결을 통해 Pexels CDN에서 로드됩니다. 완전한 오프라인 실행이 필요하면 원본 Pexels 페이지에서 사진을 내려받아 이 폴더에 저장하고, `src/data-mirror/top-image-map.json`의 `image_url`을 `/assets/top-style/파일명.jpg`로 교체하세요.

Pexels의 원본 페이지와 라이선스 조건은 배포 전에 다시 확인하세요. 상의 분류와 사진을 변경할 때는 매니페스트의 항목명을 데이터베이스 `clothing_items` 값과 정확히 일치시켜 주세요.
