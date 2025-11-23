const openButton = document.getElementById('popup-open-mex') as HTMLButtonElement | null;

openButton?.addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://mex.portal.chalmers.se/Student/Index/ea791019-0e48-11ed-8f4d-87c157374df8#tab-panel-achievements'
  });
});
